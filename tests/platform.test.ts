/**
 * The parts that differ between a Mac and a Windows PC. Both are tested on either system: the
 * choices are made from an environment and a file tree handed in, so neither needs the system it
 * is about. What only the real system can answer (does Chrome start, does the window draw) is in
 * the browser tests and in `doctor`.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Secret } from "../src/util/redact.js";
import { chromePath, isWindows, notifyCommand, openCommand, powershell, resolveCommand, secretStoreName } from "../src/util/platform.js";
import { WindowsStore, windowsSecretsDir } from "../src/accounts/secrets.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "jev-platform-"));
const touch = (file: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "");
  return file;
};

describe("where Chrome is", () => {
  it("takes the one the person named, whatever this system is", () => {
    expect(chromePath({ JEV_CHROME_PATH: "D:\\Chromium\\chrome.exe" })).toBe("D:\\Chromium\\chrome.exe");
    // Spaces are kept: the path is an argument to a program, never a line for a shell.
    expect(chromePath({ JEV_CHROME_PATH: "/opt/my browser/chrome" })).toBe("/opt/my browser/chrome");
  });

  it.runIf(isWindows)("finds a Chrome installed for everyone, or only for this person", () => {
    const root = dir();
    const programs = path.join(root, "Program Files");
    const local = path.join(root, "Local");
    const everyone = touch(path.join(programs, "Google", "Chrome", "Application", "chrome.exe"));
    expect(chromePath({ ProgramFiles: programs, LOCALAPPDATA: local })).toBe(everyone);
    // With none installed for everyone, the one under this person's own folder is used.
    const mine = touch(path.join(local, "Google", "Chrome", "Application", "chrome.exe"));
    expect(chromePath({ ProgramFiles: path.join(root, "nothing"), LOCALAPPDATA: local })).toBe(mine);
    // With no Chrome at all, the usual place is still named, so doctor can say where to install it.
    expect(chromePath({ ProgramFiles: path.join(root, "nothing"), LOCALAPPDATA: path.join(root, "nothing") })).toMatch(/nothing[\\/]Google[\\/]Chrome/);
  });
});

describe("starting a program another installer left on the PATH", () => {
  it.runIf(isWindows)("takes a real program over a wrapper Windows cannot start from Node", () => {
    const root = dir();
    const onPath = path.join(root, "npm");
    // npm leaves a wrapper, and the program it stands for under the package's own folder.
    touch(path.join(onPath, "claude.cmd"));
    const real = touch(path.join(onPath, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    expect(resolveCommand("claude", { PATH: onPath })).toBe(real);
    // A program of that name on the PATH itself wins, and is taken as it is.
    const plain = touch(path.join(root, "bin", "claude.exe"));
    expect(resolveCommand("claude", { PATH: `${path.join(root, "bin")}${path.delimiter}${onPath}` })).toBe(plain);
    // Nothing found: the name is handed back, and the error names the command the person knows.
    expect(resolveCommand("claude", { PATH: path.join(root, "empty") })).toBe("claude");
  });

  it.runIf(!isWindows)("needs no lookup, because the name on the PATH is the program", () => {
    expect(resolveCommand("claude", { PATH: "/usr/local/bin" })).toBe("claude");
  });
});

describe("asking the system to open or to say something", () => {
  it("passes a link as one argument, so an & in it cannot become a second command", () => {
    const url = "https://mail.google.com/mail/u/0/#search/acme (code OR verification) & more";
    const open = openCommand(url);
    expect(open?.args.filter((a) => a.includes("acme"))).toEqual([url]);
    expect(open?.command).toMatch(isWindows ? /rundll32\.exe$/ : /open$|xdg-open$/);
  });

  it("keeps the words of a notification out of the script that draws it", () => {
    const n = notifyCommand("jev-job-search needs you", 'Acme & Co: type the code, then click "Submit"');
    if (!n) return; // a system with no notifications of its own
    const script = isWindows ? Buffer.from(n.args.at(-1) ?? "", "base64").toString("utf16le") : n.args.join(" ");
    if (isWindows) {
      // The words travel in the environment. The script never holds them, so none of it can be rewritten by them.
      expect(n.env).toEqual({ JEV_NOTIFY_TITLE: "jev-job-search needs you", JEV_NOTIFY_BODY: 'Acme & Co: type the code, then click "Submit"' });
      expect(script).not.toContain("Acme");
      expect(script).toContain("$env:JEV_NOTIFY_BODY");
    } else {
      // On a Mac they travel as arguments to a fixed script, which is the same promise.
      expect(n.args).toContain("Acme & Co: type the code, then click \"Submit\"");
      expect(script).toContain("item 2 of argv");
    }
  });

  it.runIf(isWindows)("hands PowerShell a script it cannot misread, and asks for no profile of the person's", () => {
    const { args } = powershell("Write-Output 'one \"two\" & three'");
    expect(args).toContain("-NoProfile");
    expect(args).toContain("-NonInteractive");
    expect(Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le")).toBe("Write-Output 'one \"two\" & three'");
    // The one script a person types into needs an interactive PowerShell.
    expect(powershell("Read-Host", { interactive: true }).args).not.toContain("-NonInteractive");
  });
});

describe("the Windows credential store", () => {
  it("seals a value through standard input, never as an argument, and reads it back to be sure", () => {
    const calls: { script: string; input?: string; env?: Record<string, string> }[] = [];
    let held: string | null = null;
    let takes = true;
    const store = new WindowsStore((script, opts) => {
      calls.push({ script, ...(opts.input !== undefined ? { input: opts.input } : {}), ...(opts.env ? { env: opts.env } : {}) });
      if (/ConvertFrom-SecureString/.test(script) && !/Read-Host/.test(script)) held = takes ? (opts.input ?? "") : null;
      return { status: held === null && /Test-Path/.test(script) ? 1 : 0, stdout: /Test-Path/.test(script) ? (held ?? "") : "" };
    }, "C:\\secrets");

    const made = 'tok"en\\1 & more';
    store.set("gmail-refresh-token", new Secret(made));
    // No script and no name of a file holds the value, or a part of it.
    expect(calls.map((c) => `${c.script} ${JSON.stringify(c.env)}`).join(" ")).not.toMatch(/tok"|en\\1/);
    expect(calls[0]?.input).toBe(made);
    // Each item is its own file, named so that any item name is a plain file name.
    expect(calls[0]?.env?.JEV_SECRET_FILE).toBe(path.join("C:\\secrets", `${Buffer.from("gmail-refresh-token").toString("hex")}.dpapi`));
    expect(store.get("gmail-refresh-token")?.reveal()).toBe(made);
    expect(String(store.get("gmail-refresh-token"))).toBe("[redacted]");

    // A value with a line break in it is refused before anything runs.
    const before = calls.length;
    expect(() => store.set("x", new Secret("line one\nline two"))).toThrow(/cannot take/);
    expect(calls.length).toBe(before);

    // A store that says yes and keeps nothing is found out by reading the item back.
    takes = false;
    expect(() => store.set("y", new Secret("another-made-up-value"))).toThrow(/did not take/);
  });

  it("still reads a value a person put in .env before they had a credential store", () => {
    const name = "JEV_ACCOUNTS_PASSWORD";
    const had = process.env[name];
    process.env[name] = "from-dot-env";
    try {
      // Nothing is sealed, so the environment is what is left.
      const store = new WindowsStore(() => ({ status: 1, stdout: "" }), "C:\\secrets");
      expect(store.get("accounts-password")?.reveal()).toBe("from-dot-env");
      expect(store.get("gmail-refresh-token")).toBeNull();
    } finally {
      if (had === undefined) delete process.env[name];
      else process.env[name] = had;
    }
  });

  it("keeps its files under this account's own folder, and names the store in what it prints", () => {
    expect(windowsSecretsDir({ LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local" })).toBe(path.join("C:\\Users\\someone\\AppData\\Local", "jev-job-search", "secrets"));
    // With no folder named by Windows, the usual one under this account is worked out.
    expect(windowsSecretsDir({ USERPROFILE: "C:\\Users\\someone" })).toContain(path.join("AppData", "Local", "jev-job-search"));
    expect(secretStoreName()).toMatch(isWindows ? /Windows credential store/ : /Keychain|\.env/);
  });
});
