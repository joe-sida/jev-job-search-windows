/**
 * Stopping the Chrome a browser test started, and taking its profile folder away again.
 *
 * Chrome is not one process: it leaves renderers and a crash handler of its own behind. On a Mac
 * they go when the one the test started goes. On Windows they do not, and while one of them is
 * still alive the profile folder cannot be deleted, so the whole tree is ended first and the
 * delete is given a few tries. A profile that still will not go is left in the system's temporary
 * folder rather than failing a test about something else.
 */
import { spawnSync, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function stopChrome(chrome: ChildProcess | null, profile: string): Promise<void> {
  if (chrome?.pid && process.platform === "win32") {
    spawnSync(path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  }
  chrome?.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* a profile Windows is still holding is left in the temporary folder */
  }
}
