# jev-job-search-windows

*The job search that fills the forms for you. On Windows.*

[![ci](https://github.com/joe-sida/jev-job-search-windows/actions/workflows/ci.yml/badge.svg)](https://github.com/joe-sida/jev-job-search-windows/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![upstream: qbeka/jev-job-search](https://img.shields.io/badge/upstream-qbeka%2Fjev--job--search-lightgrey.svg)](https://github.com/qbeka/jev-job-search)

An open-source job application tool built on [Claude Code](https://claude.com/claude-code). It finds software, data and IT roles, fills the application forms in a Chrome window you can watch, reads every answer back from the page, and sends the ones you approve.

This is the Windows build. The original, [qbeka/jev-job-search](https://github.com/qbeka/jev-job-search), was written for macOS: it reached the Keychain through `/usr/bin/security`, drew its password window with `osascript`, opened links with `open`, and scheduled the daily run as a launchd LaunchAgent. None of that exists on Windows. This fork writes each of those parts a second time against what Windows actually provides, keeps the macOS versions working, and decides between them in one module. Same tool, same commands, same records. It just runs on your PC.

| | |
|---|---|
| **Who it is for** | Students and new graduates applying to software, data, machine learning, analytics or IT support roles in Canada, the United States or remotely, who are comfortable opening a terminal once. It writes in English. |
| **What you need** | Windows 10 or 11, Google Chrome, [Node.js](https://nodejs.org) 22 or newer, and [Claude Code](https://claude.com/claude-code) signed in with a Claude Pro or Max subscription. No WSL. |
| **What it costs** | Your Claude subscription, plus a few dollars of [OpenRouter](https://openrouter.ai/keys) credit for JEV: about 1 to 1.5 cents per 10 applications. Nothing else. |
| **How to start** | Clone it, run `npm install`, open `claude` in the folder and type `/setup`. About 20 minutes, most of it your answers. |
| **What it checks** | Your right to work, education and dates are taken from your profile and never changed to fit a form. Every answer is read back from the page before a form is sent. A human check is left to you. |
| **What it is not** | A download-and-open app. There is no installer and no build step: it runs TypeScript directly through `tsx`. |

> This is an independent open-source project. It is not affiliated with, endorsed by or maintained by Anthropic, OpenRouter, Microsoft, or any job board. There is no token, coin or paid tier.

## Contents

- [What runs on Windows](#what-runs-on-windows)
- [What you need](#what-you-need)
- [Install](#install)
- [Set up your profile](#set-up-your-profile)
- [Everyday use](#everyday-use)
- [Where Windows keeps your things](#where-windows-keeps-your-things)
- [Settings you may need](#settings-you-may-need)
- [Proving it works](#proving-it-works)
- [Troubleshooting](#troubleshooting)
- [What is yours and what is not](#what-is-yours-and-what-is-not)
- [Beyond the port](#beyond-the-port)
- [Known issues](#known-issues)
- [Staying current with upstream](#staying-current-with-upstream)
- [Contributing](#contributing)
- [Credits and license](#credits-and-license)

## What runs on Windows

Every system-specific part of the original has a Windows counterpart here. Each is written out in full rather than stubbed, and each is covered by tests that run on either system.

| What the tool needs | macOS (kept) | Windows (added here) |
|---|---|---|
| Find Chrome | `/Applications/Google Chrome.app/...` | Searched under `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432` and `LOCALAPPDATA`, including Chrome Beta and Canary. Override with `JEV_CHROME_PATH` |
| Keep a password or token | macOS Keychain through `/usr/bin/security` | A file sealed by DPAPI for your Windows account alone, under `%LOCALAPPDATA%\jev-job-search\secrets`. The value travels on standard input, never in a command's arguments |
| Ask you for a password | `osascript` dialog | A WinForms window drawn by PowerShell, masked, entered twice, with the same give-up timeout |
| Tell you a form needs you | `osascript` notification | A tray notification through `NotifyIcon`. The words travel in environment variables, so no notification text is ever part of the script that draws it |
| Open a file or a link | `/usr/bin/open` | `rundll32.exe url.dll,FileProtocolHandler`, with the target passed as exactly one argument so an `&` in a URL cannot become a second command |
| Run once a day by itself | launchd LaunchAgent | A Task Scheduler task registered from XML with a one-line `.cmd` wrapper, running as you, at `LeastPrivilege`, needing no administrator |
| Start Claude Code | `claude` on the `PATH` | The real `claude.exe` the npm wrapper stands for. Node cannot spawn a `.cmd` on Windows, so the bare name fails. Override with `JEV_CLAUDE_PATH` |
| Print a PDF | a `file://` URL | `pathToFileURL`, so a path with a space or a drive letter in it still loads |
| One writer at a time | `EEXIST` on the lock file | `EPERM` and `EACCES` too, which is what Windows answers for a lock file another process is deleting |

Two further changes are what make any of it start at all:

- **The child-process environment.** Every child process is started from an allow-list with no keys in it (`childEnv()`). The macOS list had nothing Windows needs, so every child would have failed before running. `SystemRoot`, `PATHEXT`, `APPDATA`, `LOCALAPPDATA`, `ComSpec`, `TEMP` and the rest of the names a Windows program needs are on it now. No key, token or password was added.
- **One place for the difference.** `src/util/platform.ts` answers which system this is. Nothing else in `src/` asks, names a path like `/usr/bin/open`, or assumes a path separator.

## What you need

- **Windows 10 or 11.** No WSL, no Cygwin, no extra runtime. PowerShell as it ships is enough.
- **Google Chrome.** The tool opens its own Chrome window with its own profile. Your everyday browser, its tabs and its logins are not touched.
- **[Node.js](https://nodejs.org) 22 or newer.** `node --version` to check.
- **[Claude Code](https://claude.com/claude-code), signed in.** Claude Code has no free tier: you need a Claude Pro or Max subscription. A Claude API key in `.env` works instead for the commands, but not for the `/` skills. See [Claude Code or the Claude API](docs/SETUP.md).
- **An [OpenRouter](https://openrouter.ai/keys) account** with a few dollars of credit. That pays for JEV, the only separate bill: about 1 to 1.5 cents for every 10 applications and 7 to 9 cents per search.

## Install

In PowerShell:

```bash
winget install OpenJS.NodeJS.LTS
```

```bash
winget install Google.Chrome
```

```bash
npm install -g @anthropic-ai/claude-code
```

Then clone and install:

```bash
git clone https://github.com/joe-sida/jev-job-search-windows
```

```bash
cd jev-job-search-windows; npm install
```

> [!IMPORTANT]
> Everything about you stays in git-ignored files (`data/`, `documents/`, `applications/`, `.env`), so your own clone can be pushed anywhere without leaking anything. The repository ships only example files.

## Set up your profile

Sign in to Claude Code once, in the project folder. The CLI keeps its own session: being signed in to the Claude desktop app is not the same thing.

```bash
claude
```

Answer the trust prompt, then type `/login` and finish in the browser. Then:

```
/setup
```

`/setup` checks what is installed, reads your resume PDF and anything else you drop into `documents/`, asks only what those do not say (where you may work, what you are looking for, how you want recurring questions answered), opens `.env` for your OpenRouter key, builds your profile, finds jobs, rehearses three forms without sending so you can correct what it got wrong, and ends with one real application filled and waiting for your yes. It is safe to run again.

## Everyday use

Type these in Claude Code. Each one also exists as `npx jev <command>` if you would rather use the terminal.

| | |
|---|---|
| `/discover` | Reads the public lists and company boards, drops what you could not or would not apply to, rates the rest against your profile with JEV, and writes a ranked queue |
| `/apply` | Fills the best queued forms, one Chrome tab each, reads every value back from the page, and sends each form once you say so |
| `/apply <url>` | Applies to one posting you found yourself |
| `/tailor <job id>` | Writes a one-page resume for that job from your profile and the posting, and with `--cover` a cover letter |
| `/report` | Opens the dashboard on your own machine: today, what needs you, every application, the daily run as a switch |
| `/status` | Where you stand in a few lines |
| `/resume` | Picks up the forms that waited for you after a code or a sign-in |
| `/daily` | A few applications a day with nobody watching, inside a policy you write. `/daily schedule 09:00` registers the Task Scheduler task; nothing is scheduled until you type that |
| `/accounts` | Boards that want an account of their own (Workday). Off until you turn it on |
| `/profile` | Changes your profile, your standing answers, your drafts and your voice guide |

The full command reference is [docs/USAGE.md](docs/USAGE.md). How a form is actually filled and verified is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Where Windows keeps your things

| What | Where |
|---|---|
| Passwords and Gmail tokens | `%LOCALAPPDATA%\jev-job-search\secrets\<item>.dpapi`, sealed by Windows for your account only. Readable by nothing and nobody else, including another account on the same PC |
| The daily task | Task Scheduler, `com.jev-job-search.daily`. Open `taskschd.msc` to see it under Task Scheduler Library |
| What the daily run printed | `data\runs\daily.log`, next to the task XML and its `.cmd` wrapper |
| Your profile, resume, queue and records | `data\`, `documents\` and `applications\` in the project folder, all git-ignored |
| The tool's Chrome profile | Its own folder, separate from your everyday Chrome |

The credential store keeps the same item names as upstream, so a profile set up with the original tool keeps working here and the other way round.

## Settings you may need

All optional. Set them in `.env` or as environment variables.

| Name | What it does |
|---|---|
| `JEV_CHROME_PATH` | The `chrome.exe` to use, if Chrome is somewhere unusual or you want Chromium |
| `JEV_CLAUDE_PATH` | The `claude.exe` to use, if Claude Code was not installed with npm and is not found |
| `OPENROUTER_API_KEY` | Your JEV key. `/setup` opens `.env` for this one |
| `ANTHROPIC_API_KEY` | Use the Claude API instead of your Claude Code subscription |
| `WRITER_BACKEND=claude-code` | Keep using Claude Code even with a Claude API key present |

An environment variable set in Windows wins over the same name in `.env`, because `.env` only fills in names that are not already set. If you edit `.env` and nothing changes, check that the name is not also in your Windows environment.

## Proving it works

```bash
npx jev doctor --online
```

`doctor` lists what is in place and what to do next. `--online` makes one tiny JEV call and one tiny Claude call to prove the key and the sign-in actually work, for a fraction of a cent. A healthy PC reports Node, Chrome, Claude Code on your subscription, your OpenRouter key, your profile and your resume.

The test suite runs offline, on either system:

```bash
npx tsc --noEmit; npx vitest run
```

436 tests across 33 files, including the two that drive a real Chrome over the DevTools Protocol. `tests/platform.test.ts` covers the Windows parts specifically: that Chrome is found whether it was installed for everyone or for one account, that a link reaches `rundll32` as a single argument, that a notification's words never enter the script that draws it, that a secret goes to DPAPI on standard input and is read back to confirm it was kept, and that the scheduled task's XML is what `schtasks` expects.

Beyond the suite, this build has been driven end to end on Windows 11: Chrome launched and a form's fields read, written and read back; a PDF printed from a path containing a space; the dashboard served; a tray notification posted; the password window drawn; a secret sealed and recovered; and a link opened with its query string intact.

## Troubleshooting

| What you see | What to do |
|---|---|
| `Chrome did not start on port 9333` | Install Google Chrome, or set `JEV_CHROME_PATH` to its `chrome.exe` |
| `could not run claude` | Install Claude Code and run `claude` once to sign in. If it is installed but not found, set `JEV_CLAUDE_PATH` to its `claude.exe` |
| `Failed to authenticate: OAuth session expired` | Run `claude` in a terminal and type `/login`. The desktop app's session is separate from the CLI's |
| `claude` prints `is not recognized as ... an operable program` | Claude Code was mid-auto-update. Run it again |
| `the password window did not open` | PowerShell is blocked by a policy. Keep the password in the terminal instead: `npx jev accounts password --terminal` |
| `EPERM` deleting a Chrome profile after a run | A Chrome child process outlived its parent. Harmless: the folder is left in `%TEMP%` and the run is unaffected |
| The daily task never runs | Task Scheduler runs it only while you are signed in, and Windows does not catch up on a run it missed. Check `data\runs\daily.log` |
| A change to `.env` has no effect | The same name is set in your Windows environment, which wins. See [Settings you may need](#settings-you-may-need) |

## What is yours and what is not

- **Nothing about you is in this repository.** `data/profile.json`, your resume, your queue, your records, your notes and `.env` are git-ignored, and CI fails if any of them is ever committed.
- **Secrets are never in a file of this project, a command's arguments, a prompt, a report or a log.** They live in the credential store and travel as a `Secret` that prints as `[redacted]`.
- **The tool solves no human checks.** A CAPTCHA, a phone code or an emailed confirmation code stops the form, leaves it open and filled, and tells you. It never reads such a code from your mail or types one.
- **It signs in only where you set it up**, with a password you stored for that employer, on an origin that account allows.
- **Truth is not negotiable.** Work authorization, education and dates come from your profile. A required question the profile cannot answer truthfully holds the form and goes on the by-hand list with the reason.

[docs/SAFETY.md](docs/SAFETY.md) is the long version.

## Beyond the port

Three changes in this build are not about Windows. They are noted here so nobody mistakes them for upstream behaviour:

- **A list's shortened links are followed before anything is decided.** One public list gives every posting a `go.vansh.nyc` link, which hides the board. Arriving as `other`, each one escaped the rules that skip a board wanting an account, was rated at JEV's expense, and then cost a run up to three minutes on a page that could never produce a form. Discovery now follows the link once and reads the board from where it lands. On a sample of twelve: five became boards the tool applies to, with the form's own URL worked out, and seven were skipped for free. The posting keeps its own link as its identity, so nothing already recorded against a job moves.

- **The job scope is wider.** Upstream keeps software engineering titles. This build also keeps data, machine learning, AI, analytics and IT systems support titles, in the title filter and in the question JEV is asked about a posting. The saved key for that question is unchanged, so existing ratings and reports still read.
- **A resume written for every job can be made mandatory.** Setting `"tailorResume": "always"` under `preferences` in your profile writes a resume per job, and is strict about it: a job whose resume could not be written is held with the reason instead of being sent with your master resume.

Everything else in `src/` differs from upstream only where Windows needed it to.

## Known issues

- **`npm audit` reports one high advisory.** [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), in zod 3: memory exhaustion while validating oversized constrained collections. It is inherited from upstream, which pins zod 3, and the fix is zod 4, a breaking upgrade. CI names this advisory as a known exception and still fails on any other high or critical one.
- **Linux is a fallback, not a port.** The browser, the PDF printing and the records work. There is no credential store (a password is read from `.env`), no notifications, and no scheduler of its own: run `npx jev daily` from cron.
- **Two upstream features are still in progress** and off by default: applying on boards that want an account (Workday, through `/accounts`) and the Gmail connection used for verification emails and `/inbox`. See [docs/ACCOUNTS.md](docs/ACCOUNTS.md) for what has and has not been tested.
- **Boards it has not met will hold a form** rather than guess, and say so in `applications/manual.csv`.

## Staying current with upstream

This fork keeps the original's full history, so upstream changes merge normally:

```bash
git remote add upstream https://github.com/qbeka/jev-job-search
```

```bash
git fetch upstream; git merge upstream/main
```

Conflicts, when they happen, are almost always in the files the port touched: `src/util/platform.ts` has no upstream counterpart, and `src/config.ts`, `src/accounts/`, `src/run/schedule.ts` and `src/util/store.ts` are where the two systems meet.

## Contributing

Bug reports, fixes for a form that filled wrongly, new job sources and site notes are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers how the code is organized and what to run before a pull request.

One request: **a fix that is not about Windows belongs upstream.** Send it to [qbeka/jev-job-search](https://github.com/qbeka/jev-job-search) so every user gets it, and it will arrive here on the next merge. Open it here if it touches `src/util/platform.ts`, the DPAPI store, the PowerShell dialog, Task Scheduler, or anything else that only Windows sees.

Before a pull request:

```bash
npx tsc --noEmit; npx vitest run; npm audit --omit=dev
```

## Credits and license

The tool is Qendrim Beka's. This repository is a derivative work: the Windows parts, the tests that cover them, and this README. Everything else is the original.

- [qbeka/jev-job-search](https://github.com/qbeka/jev-job-search) (MIT), the original and the upstream for this fork.
- [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search) (MIT) for the drafter and reviewer method behind the tailored resume and cover letter.
- [SimplifyJobs](https://github.com/SimplifyJobs) for the public internship and new-grad lists the tool reads.
- [typesafe/jev-1.13](https://openrouter.ai/typesafe/jev-1.13) for a model that answers a typed question with a probability.

MIT, the same licence as the original, whose copyright notice is kept in [LICENSE](LICENSE) unchanged.
