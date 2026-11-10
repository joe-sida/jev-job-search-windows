/**
 * The few things that differ between the systems this runs on: where Chrome is, how a file or a
 * link is opened, how a notification is posted, and how a command another installer put on the
 * PATH is actually started. Everything that asks "which system is this?" lives here, so the rest
 * of the code reads the same on a Mac and on Windows.
 *
 * Nothing here imports the configuration: the configuration asks this module where Chrome is.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";

/** What a child process is started with: a program and its arguments, never a line for a shell to read. */
export type Command = { command: string; args: string[] };

const firstThatExists = (files: string[]): string | null => files.find((f) => f && existsSync(f)) ?? null;

/**
 * Where Google Chrome is on this machine. JEV_CHROME_PATH wins, so a Chrome in an unusual place,
 * or a Chromium-based browser, needs no change to the code. When nothing is found, the usual place
 * for this system is returned anyway: `doctor` then names that path as the one to install to.
 */
export function chromePath(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.JEV_CHROME_PATH?.trim();
  if (set) return set;
  if (isWindows) {
    const programs = [env["ProgramFiles"], env["ProgramFiles(x86)"], env["ProgramW6432"], env["LOCALAPPDATA"]].filter((d): d is string => !!d);
    const usual = programs.map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe"));
    // A Chrome the person installed only for themselves, and the business build, in that order after the usual ones.
    const others = [
      path.join(env["LOCALAPPDATA"] ?? "", "Google", "Chrome SxS", "Application", "chrome.exe"),
      path.join(env["ProgramFiles"] ?? "", "Google", "Chrome Beta", "Application", "chrome.exe"),
    ];
    return firstThatExists([...usual, ...others]) ?? path.join(env["ProgramFiles"] ?? "C:\Program Files", "Google", "Chrome", "Application", "chrome.exe");
  }
  if (isMac) {
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return firstThatExists([mac, path.join(homedir(), mac)]) ?? mac;
  }
  return firstThatExists(["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/snap/bin/chromium"]) ?? "/usr/bin/google-chrome";
}

/** Windows PowerShell, which does the work osascript does on a Mac. */
const powershellExe = (env: NodeJS.ProcessEnv = process.env): string =>
  firstThatExists([path.join(env["SystemRoot"] ?? "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")]) ?? "powershell.exe";

/**
 * A PowerShell script, as a command. The script travels base64-encoded, so no quoting of its own
 * text is needed and nothing a person typed is ever part of it: values reach the script through
 * the environment or through standard input. `interactive` is for the one script that asks the
 * person to type something, which a non-interactive PowerShell would refuse.
 */
export function powershell(script: string, o: { interactive?: boolean; env?: NodeJS.ProcessEnv } = {}): Command {
  const flags = ["-NoProfile", ...(o.interactive ? [] : ["-NonInteractive"]), "-ExecutionPolicy", "Bypass"];
  return { command: powershellExe(o.env ?? process.env), args: [...flags, "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")] };
}

/**
 * Reading standard input and writing standard output as UTF-8 from a PowerShell script, without
 * touching the console's own encoding, which a script whose input is a pipe is not allowed to set.
 */
export const PS_STDIN = 'New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)';
export const PS_STDOUT = 'New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)))';

/**
 * Opening a file or a link with whatever this system opens it with. The target travels as one
 * argument to a program, never through a shell, so a link with an `&` in it cannot become a second
 * command. Null on a system this does not know, where help that cannot be given is not an error.
 */
export function openCommand(target: string): Command | null {
  if (isMac) return { command: "/usr/bin/open", args: [target] };
  // url.dll's handler is the one Windows entry point that takes a file or a URL as a single argument.
  if (isWindows) return { command: path.join(process.env["SystemRoot"] ?? "C:\Windows", "System32", "rundll32.exe"), args: ["url.dll,FileProtocolHandler", target] };
  return existsSync("/usr/bin/xdg-open") ? { command: "/usr/bin/xdg-open", args: [target] } : null;
}

/**
 * A notification, with the words as arguments or in the environment and never as script text.
 * On Windows a tray balloon is used: Windows draws it as a notification, and unlike a toast it
 * needs nothing registered first.
 */
export function notifyCommand(title: string, body: string): (Command & { env?: Record<string, string> }) | null {
  if (isMac) return { command: "/usr/bin/osascript", args: ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body] };
  if (!isWindows) return null;
  const script = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.BalloonTipTitle = $env:JEV_NOTIFY_TITLE
$icon.BalloonTipText = $env:JEV_NOTIFY_BODY
$icon.Visible = $true
$icon.ShowBalloonTip(10000)
Start-Sleep -Seconds 10
$icon.Dispose()
`;
  return { ...powershell(script), env: { JEV_NOTIFY_TITLE: title, JEV_NOTIFY_BODY: body } };
}

/**
 * Where a command another installer put on the PATH really is. On a Mac the name is enough. On
 * Windows a name has to be looked up: npm leaves a `claude.cmd` behind, which Node refuses to
 * start, and the program it stands for is an `.exe` next to it or under its own package.
 */
export function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isWindows || path.isAbsolute(name)) return name;
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  // A real program first: Windows cannot start a .cmd or a .bat from Node, only a shell can.
  const real = [".exe", ".com"];
  for (const dir of dirs) {
    const hit = firstThatExists(real.map((ext) => path.join(dir, name + ext)));
    if (hit) return hit;
  }
  // Then the program a wrapper on the PATH stands for: npm's own layout, and the one next to it.
  for (const dir of dirs) {
    if (!firstThatExists([path.join(dir, `${name}.cmd`), path.join(dir, `${name}.bat`), path.join(dir, name)])) continue;
    const packaged = packagedExe(dir, name);
    if (packaged) return packaged;
  }
  return name;
}

/** The `.exe` a global npm package ships, under the folder that holds its wrapper. */
function packagedExe(dir: string, name: string): string | null {
  const roots = [path.join(dir, "node_modules"), path.join(dir, "..", "node_modules")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    // A scoped package (@anthropic-ai/claude-code) keeps its binaries one level deeper.
    const scopes = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("@"));
    const packages = [root, ...scopes.map((s) => path.join(root, s.name))];
    for (const base of packages) {
      const hit = readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(base, e.name, "bin", `${name}.exe`))
        .find((f) => existsSync(f));
      if (hit) return hit;
    }
  }
  return null;
}

/** The words for the place this system keeps passwords, as they appear in what the tool prints and asks. */
export const secretStoreName = (): string => (isMac ? "your Mac's Keychain" : isWindows ? "the Windows credential store" : "your .env file");
