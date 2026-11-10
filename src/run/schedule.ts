/**
 * Running `daily` every day at a set time, through the system's own scheduler: a LaunchAgent in
 * the person's account on a Mac, a task in Task Scheduler on Windows. Nothing is installed until
 * the person runs `schedule install`, and `schedule remove` takes it away again. Both are
 * registered for this account alone and need nothing administrative, so the machine has to be on
 * and the person signed in at that time.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { childEnv, DAILY, PATHS, ROOT } from "../config.js";
import { isMac, isWindows } from "../util/platform.js";

/** Which scheduler a machine has. Null where there is neither, and the person runs `daily` from their own. */
export type Scheduler = "launchd" | "taskscheduler";
export const schedulerOf = (): Scheduler | null => (isMac ? "launchd" : isWindows ? "taskscheduler" : null);

/** The file a schedule is written to: the LaunchAgent itself, or the definition Task Scheduler was given. */
export const agentFile = (home = homedir()) => path.join(home, "Library", "LaunchAgents", `${DAILY.label}.plist`);
export const taskFile = () => path.join(PATHS.runs, `${DAILY.label}.xml`);
/** The one-line batch file the Windows task runs: it starts `jev daily` and appends what it prints to the log. */
export const taskWrapperFile = () => path.join(PATHS.runs, `${DAILY.label}.cmd`);

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "09:00" as an hour and a minute. Null for anything that is not a time of day. */
export function timeOfDay(at: string): { hour: number; minute: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(at.trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

const hhmm = (t: { hour: number; minute: number }) => `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;

/** The LaunchAgent: run `jev daily` in the project folder at that time each day, with its output in the daily log. */
export function agentPlist(o: { node: string; root: string; hour: number; minute: number; searchPath: string; log: string }): string {
  const str = (s: string) => `<string>${xml(s)}</string>`;
  // A Mac's own paths, whatever system this was written on.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(DAILY.label)}
  <key>ProgramArguments</key>
  <array>${str(o.node)}${str(path.posix.join(o.root, "bin", "jev.js"))}${str("daily")}</array>
  <key>WorkingDirectory</key>${str(o.root)}
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${o.hour}</integer><key>Minute</key><integer>${o.minute}</integer></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key>${str(o.searchPath)}</dict>
  <key>StandardOutPath</key>${str(o.log)}
  <key>StandardErrorPath</key>${str(o.log)}
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
}

/**
 * The batch file the Windows task starts. Task Scheduler cannot send what a program prints to a
 * file, so this one line does, the way the LaunchAgent's StandardOutPath does on a Mac.
 */
export function taskWrapper(o: { node: string; root: string; log: string }): string {
  return ["@echo off", `"${o.node}" "${path.join(o.root, "bin", "jev.js")}" daily >> "${o.log}" 2>&1`, ""].join("\r\n");
}

/**
 * The Windows task: run that batch file in the project folder at that time each day, as this
 * person, only while they are signed in, and never two at once. The date in StartBoundary only
 * says the schedule has begun; what matters is the time of day and the daily interval.
 */
export function taskXml(o: { wrapper: string; root: string; hour: number; minute: number }): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>jev-job-search: the daily run (npx jev daily). Remove it with: npx jev schedule remove</Description>
    <URI>\\${xml(DAILY.label)}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2024-01-01T${String(o.hour).padStart(2, "0")}:${String(o.minute).padStart(2, "0")}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT${Math.ceil(DAILY.maxMinutes / 60) + 1}H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(o.wrapper)}</Command>
      <WorkingDirectory>${xml(o.root)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** A scheduler command: the arguments, and what it answered. The same shape for both systems, so a test can stand in for either. */
export type Runner = (args: string[]) => { status: number | null };

const launchctl: Runner = (args) => spawnSync("/bin/launchctl", args, { encoding: "utf8", env: childEnv() });
const schtasks: Runner = (args) => spawnSync(path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "schtasks.exe"), args, { encoding: "utf8", env: childEnv() });
const domain = () => `gui/${process.getuid?.() ?? 0}`;

type Options = { file?: string; run?: Runner; node?: string; root?: string; searchPath?: string; scheduler?: Scheduler };

/** What a call works with: the scheduler, its command and its file. A test gives all three. */
function wiring(o: Options): { scheduler: Scheduler; run: Runner; file: string } {
  const scheduler = o.scheduler ?? schedulerOf() ?? (o.run ? "launchd" : null) ?? never();
  const run = o.run ?? (scheduler === "launchd" ? launchctl : schtasks);
  const file = o.file ?? (scheduler === "launchd" ? agentFile() : taskFile());
  return { scheduler, run, file };
}

const never = (): never => {
  throw new Error("this system has no scheduler of its own. Run `npx jev daily` from your own scheduler");
};

export function installSchedule(at: string = DAILY.at, o: Options = {}): { file: string; at: string } {
  const { scheduler, run, file } = wiring(o);
  const time = timeOfDay(at);
  if (!time) throw new Error(`"${at}" is not a time of day. Give it as HH:MM, for example 09:00`);
  const node = o.node ?? process.execPath;
  const root = o.root ?? ROOT;
  mkdirSync(path.dirname(file), { recursive: true });
  mkdirSync(path.dirname(PATHS.dailyLog), { recursive: true });
  if (scheduler === "launchd") {
    // One that is already loaded is taken out first, so a new time replaces the old one.
    run(["bootout", `${domain()}/${DAILY.label}`]);
    writeFileSync(file, agentPlist({ node, root, ...time, searchPath: o.searchPath ?? process.env.PATH ?? "/usr/bin:/bin", log: PATHS.dailyLog }));
    if (run(["bootstrap", domain(), file]).status !== 0) throw new Error(`macOS did not take the schedule. The file is at ${file}`);
    return { file, at: hhmm(time) };
  }
  const wrapper = taskWrapperFile();
  writeFileSync(wrapper, taskWrapper({ node, root, log: PATHS.dailyLog }));
  // Task Scheduler reads a definition as UTF-16 with a byte-order mark, and nothing else.
  writeFileSync(file, `\ufeff${taskXml({ wrapper, root, ...time })}`, "utf16le");
  // /F replaces a task that is already there, so a new time replaces the old one.
  if (run(["/Create", "/TN", DAILY.label, "/XML", file, "/F"]).status !== 0) throw new Error(`Windows did not take the schedule. The definition is at ${file}`);
  return { file, at: hhmm(time) };
}

export function removeSchedule(o: Options = {}): boolean {
  const { scheduler, run, file } = wiring(o);
  const was = existsSync(file);
  if (scheduler === "launchd") run(["bootout", `${domain()}/${DAILY.label}`]);
  else {
    run(["/Delete", "/TN", DAILY.label, "/F"]);
    rmSync(taskWrapperFile(), { force: true });
  }
  rmSync(file, { force: true });
  return was;
}

/** Whether a schedule is installed, whether the system has it loaded, and the time of day it runs. */
export function scheduleStatus(o: Options = {}): { installed: boolean; loaded: boolean; file: string; at: string | null } {
  const { scheduler, run, file } = wiring(o);
  const installed = existsSync(file);
  let at: string | null = null;
  if (installed) {
    const text = readFileSync(file, scheduler === "launchd" ? "utf8" : "utf16le");
    const m =
      scheduler === "launchd"
        ? /<key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer>/.exec(text)
        : /<StartBoundary>\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(text);
    if (m) at = `${String(m[1]).padStart(2, "0")}:${String(m[2]).padStart(2, "0")}`;
  }
  const query = scheduler === "launchd" ? ["print", `${domain()}/${DAILY.label}`] : ["/Query", "/TN", DAILY.label];
  return { installed, loaded: installed && run(query).status === 0, file, at };
}

/** The next moment a schedule at this time of day runs, after now. */
export function nextRun(at: string, now = new Date()): Date | null {
  const t = timeOfDay(at);
  if (!t) return null;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.hour, t.minute, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}
