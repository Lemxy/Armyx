# Armyx (the app is called Taurium)

A fast desktop workspace for running **several AI coding agents on one project, safely**, with a shared memory of the project and an honest bill (Tauri + React + Rust). You wire agents into an *orchestra* on a canvas: a lead briefs the workers, they work in an isolated git worktree, and nothing touches your project until you have read the diff and pressed Apply.

## What it is for

### Speed and the orchestra
- A canvas where a lead agent briefs worker agents along the links you draw, collects their answers and writes one final answer. Claude (Claude Code CLI), Antigravity and DeepSeek today, Codex next.
- Blocks run **in parallel** as soon as their inputs are ready (or one at a time if you switch to a queue). A block whose input has not changed reuses its answer: no call, no cost, no wait. The code state is part of that check, so an answer is not reused after the code changed.
- The lead keeps its Claude session between runs (`--resume`), so the dialogue is not sent again; unchanging prompt parts go first so the provider's prompt cache can reuse them; agents are asked for terse answers (fewer output tokens, smaller handoffs).
- A transient API error (overload, rate limit, 5xx, timeout) is retried twice with a pause; a bad key or model fails at once.
- The graph follows your code: a watcher re-scans two seconds after the last change. The scanner remembers what each file said (by size and modification time) and reads again only the files that changed; links between files are always worked out again from the whole set, so the result is identical to a full scan (a test checks that after edits, new files and deletions). On Django (3,408 files; the scanner holds about 36 MB for it) a full scan takes 1.1 s; after one edit, scan and write together take 0.6 to 1.0 s instead of 1.4 s. A small project is instant either way (this repo: 0.15 s).
- No per-prompt hooks, no model to download, no background daemon: the app is a plain native binary.

### Safe by default
- Agents run without permission prompts, so each orchestra works in its **own git worktree on its own branch**. *Changes* shows the diff, *Apply* brings it into your project (uncommitted), *Discard* throws it away.
- If a block cannot be isolated (not a git repository, no commit) the run stops with a clear message; it never falls back to working in the real project. You can switch isolation off per orchestra.
- A run stops starting new blocks after $10; a single Claude call is capped at $3. Stop kills the agents and their children.
- API keys live in the OS keychain (Windows Credential Manager, macOS Keychain, Secret Service), not in project folders or exported notes.

### Shared project memory
- Open a code folder and the scanner turns it into **notes**, one per file: path, purpose, comments and docstrings, exports, symbols (HTTP routes, Tauri commands, constants), and links between files, including a server route and the Rust or React code behind it.
- You write your own notes next to them (`->@name` links, `?about:` lines, checklists, tags). A rescan never touches what you wrote.
- You browse it as a graph; the lead agent and the chat get it as a compact map of the project.

### Know what it costs
- Every run posts a table of who spent how many tokens and how much money (new input, cache reads, output, dollars where the CLI reports them); a block that reused its answer is marked as free.
- The sidebar shows your real Claude and Antigravity plan limits.
- Costs are reported only where the provider reports them: Claude gives dollars, DeepSeek and Antigravity give tokens.

## What it is not

It is **not a token saver and not an accuracy booster**. We tried that and measured it: a compact map of the project, hooks that feed it to Claude Code, a graph tool server and semantic search did not make an agent more accurate or cheaper on tasks that plain grep already handles (bug fixes, a noisy monorepo, bugs across modules, multi-file questions, 208 fresh pre-registered questions on big repos). All of it was removed. The evidence, the scripts and the raw results are in [`archive/map-bench/`](archive/map-bench/README.md).

## Run it

```bash
npm install
npm run tauri dev          # the app
npm test                   # TypeScript tests
cd src-tauri && cargo test # Rust tests
npx tauri build            # installer (unsigned)
```

You need the CLIs of the agents you want to use (`claude`, `agy`) signed in, and `git` for isolation. DeepSeek and the Gemini image models take an API key in Settings.

## Known limits

- One worktree per orchestra, so parallel agents inside it share it; it starts from `HEAD`, so uncommitted work in the project is not in it.
- The installer is not signed and there is no auto-update; only Windows has been built and run here, CI covers Linux and macOS but it has not run yet.
- Codex is wired in the backend but disabled in the menu.
- A rescan still walks the whole folder and compares every note with the one on disk (about 0.4 s and 0.25 s on Django); the remaining time is that, not reading files. The scanner's memory is lost when the app closes, so the first scan after opening is a full one.
- A file edited within the last two seconds is always read again (a coarse file clock could hide the next edit).
