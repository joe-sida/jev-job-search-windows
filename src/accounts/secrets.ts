/**
 * Where passwords and tokens live. On a Mac that is the Keychain, through the system's own
 * `security` command. On Windows it is a file the system has sealed for this account alone (the
 * Data Protection API, what Windows keeps its own saved passwords with): another account on the
 * machine, and the file copied anywhere else, cannot open it. A value is handed out only as a
 * Secret, which cannot be printed or saved by accident, and it never travels in a command's
 * arguments, where another process could read it.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ACCOUNTS, childEnv } from "../config.js";
import { isMac, isWindows, powershell, PS_STDIN, PS_STDOUT } from "../util/platform.js";
import { Secret } from "../util/redact.js";

export interface SecretStore {
  get(name: string): Secret | null;
  /** Stores a value the tool produced itself (a token). */
  set(name: string, value: Secret): void;
  /** Lets the person type a value into the store themselves. The tool never holds it. True when it was stored. */
  setByPerson(name: string): boolean;
  delete(name: string): void;
}

type Runner = (args: string[], opts: { input?: string; inherit?: boolean }) => Pick<SpawnSyncReturns<string>, "status" | "stdout">;

const security: Runner = (args, opts) =>
  spawnSync("/usr/bin/security", args, { encoding: "utf8", env: childEnv(), stdio: opts.inherit ? "inherit" : ["pipe", "pipe", "pipe"], ...(opts.input !== undefined ? { input: opts.input } : {}) });

/** The macOS Keychain. `run` is the `security` command, replaceable in a test. */
export class KeychainStore implements SecretStore {
  constructor(private readonly run: Runner = security, private readonly service: string = ACCOUNTS.keychainService) {}

  get(name: string): Secret | null {
    const r = this.run(["find-generic-password", "-s", this.service, "-a", name, "-w"], {});
    const value = (r.stdout ?? "").replace(/\n$/, "");
    return r.status === 0 && value ? new Secret(value) : null;
  }

  set(name: string, value: Secret): void {
    // The value goes in on standard input, as one command line to `security -i`, never as an argument.
    // A line break would end that line and start another command, so a value with one is refused.
    if (/[\x00-\x1f\x7f]/.test(value.reveal())) throw new Error(`the value for ${name} holds a character the Keychain command cannot take`);
    const quoted = `"${value.reveal().replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const r = this.run(["-i"], { input: `add-generic-password -U -s "${this.service}" -a "${name}" -w ${quoted}\n` });
    // The command's own exit code says little, so the item is read back.
    if (r.status !== 0 || this.get(name)?.reveal() !== value.reveal()) throw new Error(`the Keychain did not take ${name}`);
  }

  setByPerson(name: string): boolean {
    // With -w last and no value, `security` asks for it itself, twice, without showing it.
    return this.run(["add-generic-password", "-U", "-s", this.service, "-a", name, "-w"], { inherit: true }).status === 0;
  }

  delete(name: string): void {
    this.run(["delete-generic-password", "-s", this.service, "-a", name], {});
  }
}

/** Where Windows keeps this tool's sealed files: under this account's own application data. */
export const windowsSecretsDir = (env: NodeJS.ProcessEnv = process.env): string =>
  path.join(env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? ".", "AppData", "Local"), ACCOUNTS.keychainService, "secrets");

/** An item's own file. The name is written as hex, so any name is a plain file name and two names never collide. */
const fileFor = (dir: string, name: string): string => path.join(dir, `${Buffer.from(name, "utf8").toString("hex")}.dpapi`);

/** What a PowerShell script is run with: its text, what it reads, and whether the person types into it. */
export type PsRunner = (script: string, opts: { input?: string; inherit?: boolean; env?: Record<string, string> }) => Pick<SpawnSyncReturns<string>, "status" | "stdout">;

const runPowershell: PsRunner = (script, opts) => {
  const { command, args } = powershell(script, opts.inherit ? { interactive: true } : {});
  return spawnSync(command, args, { encoding: "utf8", env: childEnv(opts.env ?? {}), stdio: opts.inherit ? "inherit" : ["pipe", "pipe", "pipe"], ...(opts.input !== undefined ? { input: opts.input } : {}) });
};

/** Reads the file back. Only this account on this machine can, and the system's own call is the way in. */
const GET = `$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $env:JEV_SECRET_FILE)) { exit 1 }
$sealed = [System.IO.File]::ReadAllText($env:JEV_SECRET_FILE)
$secure = ConvertTo-SecureString -String $sealed
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $out = ${PS_STDOUT}
  $out.Write([System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))
  $out.Flush()
} finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }`;

/** Seals a value the tool made itself. It arrives on standard input, never as an argument. */
const SET = `$ErrorActionPreference = 'Stop'
$reader = ${PS_STDIN}
$plain = $reader.ReadToEnd()
if ($plain.Length -eq 0) { exit 1 }
$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
[System.IO.File]::WriteAllText($env:JEV_SECRET_FILE, (ConvertFrom-SecureString -SecureString $secure))`;

/** The person types it, twice, into Windows's own hidden prompt. This process never sees it. */
const SET_BY_PERSON = `$ErrorActionPreference = 'Stop'
$first = Read-Host -AsSecureString -Prompt 'Password'
$again = Read-Host -AsSecureString -Prompt 'Password again'
$a = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$b = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($again)
try {
  if ([System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($a) -cne [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) {
    Write-Host 'The two did not match. Nothing was stored.'
    exit 1
  }
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a)
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
}
[System.IO.File]::WriteAllText($env:JEV_SECRET_FILE, (ConvertFrom-SecureString -SecureString $first))`;

/**
 * Windows. Each value is a file the system has sealed for this account, and an environment
 * variable a person put in .env is still read when there is no file, so a setup that started
 * that way keeps working. `run` is PowerShell, replaceable in a test.
 */
export class WindowsStore implements SecretStore {
  constructor(
    private readonly run: PsRunner = runPowershell,
    private readonly dir: string = windowsSecretsDir(),
  ) {}

  get(name: string): Secret | null {
    const r = this.run(GET, { env: { JEV_SECRET_FILE: fileFor(this.dir, name) } });
    const value = r.stdout ?? "";
    if (r.status === 0 && value) return new Secret(value);
    const fromEnv = process.env[envNameOf(name)];
    return fromEnv ? new Secret(fromEnv) : null;
  }

  set(name: string, value: Secret): void {
    // A value is handed back exactly as it was given. Anything the sealing cannot carry is refused.
    if (/[\x00-\x1f\x7f]/.test(value.reveal())) throw new Error(`the value for ${name} holds a character the credential store cannot take`);
    mkdirSync(this.dir, { recursive: true });
    const r = this.run(SET, { input: value.reveal(), env: { JEV_SECRET_FILE: fileFor(this.dir, name) } });
    // The command's own exit code says little, so the item is read back.
    if (r.status !== 0 || this.get(name)?.reveal() !== value.reveal()) throw new Error(`Windows did not take ${name}`);
  }

  setByPerson(name: string): boolean {
    mkdirSync(this.dir, { recursive: true });
    return this.run(SET_BY_PERSON, { inherit: true, env: { JEV_SECRET_FILE: fileFor(this.dir, name) } }).status === 0;
  }

  delete(name: string): void {
    rmSync(fileFor(this.dir, name), { force: true });
  }
}

/** The environment variable that stands in for a stored item on a machine without a credential store: "accounts-password" is JEV_ACCOUNTS_PASSWORD. */
export const envNameOf = (item: string) => `JEV_${item.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

/** Environment variables, for a machine with no credential store. The values are read here and nowhere else. */
export class EnvStore implements SecretStore {
  get(name: string): Secret | null {
    const v = process.env[envNameOf(name)];
    return v ? new Secret(v) : null;
  }
  set(): void {
    throw new Error("this machine has no credential store: put the value in .env yourself");
  }
  setByPerson(): boolean {
    return false;
  }
  delete(): void {
    /* nothing to delete: the person owns .env */
  }
}

/** A store in memory, for tests. */
export class MemoryStore implements SecretStore {
  readonly values = new Map<string, string>();
  get(name: string): Secret | null {
    const v = this.values.get(name);
    return v ? new Secret(v) : null;
  }
  set(name: string, value: Secret): void {
    this.values.set(name, value.reveal());
  }
  setByPerson(): boolean {
    return false;
  }
  delete(name: string): void {
    this.values.delete(name);
  }
}

/** The stored item that holds one employer account's own password. */
export const itemFor = (accountId: string) => `account:${accountId}`;

/**
 * A new random password for one employer account: long, with every kind of character a board asks
 * for. Each account gets its own, so nothing is shared between employers and the person has no
 * password to think of.
 */
export function generatePassword(): Secret {
  const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%*-_=+"];
  const pick = (from: string) => from[randomInt(from.length)] as string;
  const chars = [...sets.map(pick), ...Array.from({ length: ACCOUNTS.generatedLength - sets.length }, () => pick(sets.join("")))];
  // Shuffled, so the four that were forced are not always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return new Secret(chars.join(""));
}

export const defaultStore = (): SecretStore => (isMac ? new KeychainStore() : isWindows ? new WindowsStore() : new EnvStore());

/** Which of a board's password rules a password does not meet. Says which rules, never the password. */
export function passwordProblems(password: Secret): string[] {
  const p = password.reveal();
  const r = ACCOUNTS.mustHave;
  const out: string[] = [];
  // A credential store hands back anything else in another form, which would then be typed as the password.
  if (/[^\x21-\x7e]/.test(p)) out.push("only letters, digits and symbols from a plain keyboard, with no spaces");
  if (p.length < r.minLength) out.push(`at least ${r.minLength} characters`);
  if (r.digit && !/\d/.test(p)) out.push("a digit");
  if (r.lower && !/[a-z]/.test(p)) out.push("a lower-case letter");
  if (r.upper && !/[A-Z]/.test(p)) out.push("an upper-case letter");
  if (r.special && !/[^A-Za-z0-9]/.test(p)) out.push("a special character");
  return out;
}
