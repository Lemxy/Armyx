<img src="src-tauri/icons/128x128.png" width="72" alt="" align="right">

# Armyx

Armyx runs several AI coding agents on one project. You connect them on a canvas: a lead agent briefs the workers, they work in a separate git worktree, and your project stays untouched until you read the diff and press Apply. The desktop app is called Taurium and is built with Tauri, React and Rust.

## Download

Windows installer: [Releases](https://github.com/Lemxy/Armyx/releases/latest). It is not signed, so Windows SmartScreen will warn on first launch (More info, then Run anyway). For macOS and Linux, build it from source (see below).

## Benchmark

<img src="docs/bench-orchestra.svg" width="820" alt="Cost saved per call by each orchestra technique: final answer on Haiku 91%, review resumes the session 76%, staggered parallel start 66%, code slice in the brief 56%, reviewer gets the git diff 11%">

Each row compares a call with and without one technique. These are real `claude -p` runs with the flags the app uses, on Sonnet 5.5 workers. Script: [`archive/map-bench/orchestra.mjs`](archive/map-bench/orchestra.mjs).

| Technique | Cost per call | Agent turns | Time | Correct | Runs |
|---|---|---|---|---|---|
| Final answer written by Haiku instead of the lead's model | $0.0102 → $0.0009 (−91%) | 1 → 1 | 6.6 → 8.2 s | 6/6 → 6/6 | 6 |
| Review round continues the worker's session | $0.0296 → $0.0072 (−76%) | 4.5 → 2.0 | 17.3 → 9.3 s | 6/6 → 6/6 | 6 |
| Parallel calls started apart, so the first one fills the prompt cache | $0.120 → $0.041 (−66%) for 4 calls | 4 → 4 | 6.6 → 12.2 s | n/a | 3 |
| Brief includes the code it mentions | $0.0178 → $0.0079 (−56%) | 2.8 → 1.1 | 10.0 → 6.8 s | 30/30 → 30/30 | 30 |
| Reviewer gets the git diff | $0.0215 → $0.0191 (−11%) | 2.7 → 1.7 | 12.1 → 10.8 s | n/a | 6 |

The staggered start was measured with a 6 s gap. The app now uses 1.5 s, which in a smaller test (3 groups of 4 calls) kept nearly the same saving and finished about 4 s sooner. Most rows have 6 runs, so treat differences under about 10% as noise. To redraw the chart from your own run: `node archive/map-bench/chart.mjs`.

Two more things cost nothing. A block whose input has not changed reuses its previous answer without calling the model. The scanner re-reads only changed files: a full scan of Django (3,408 files) takes 1.1 s, a rescan after one edit 0.6 to 1.0 s, and this repo 0.15 s.

## Features

### Orchestra
- The lead briefs workers along the links you draw, collects their answers and writes the final one. Supported: Claude (Claude Code CLI), Antigravity, DeepSeek, OpenRouter, NVIDIA NIM. Codex is next.
- Blocks run in parallel once their inputs are ready, or in a queue if you prefer. Reuse checks the code state too, so an old answer is not reused after the code changed.
- The lead keeps its Claude session between runs (`--resume`) and does not resend the dialogue. Fixed prompt parts come first so the provider's cache can reuse them. Agents are asked to answer briefly.
- Overload, rate limit, 5xx and timeout errors are retried twice with a pause. A bad key or model fails immediately.
- A watcher rescans the project two seconds after the last change. The result matches a full scan; a test checks this after edits, new files and deletions.
- No per-prompt hooks, no model to download, no background service. The app is a single native binary.

### Safety
- Agents run without permission prompts, so each orchestra works in its own git worktree on its own branch. Changes shows the diff, Apply copies it into your project as uncommitted changes, Discard deletes it.
- If a block cannot be isolated (not a git repo, or no commits yet), the run stops with a message. It never falls back to editing the real project. Isolation can be turned off per orchestra.
- A run stops starting new blocks after $10, and a single Claude call is capped at $3. Stop kills the agents and their child processes.
- API keys are stored in the OS keychain (Windows Credential Manager, macOS Keychain, Secret Service), not in project files or exported notes.

### Project memory
- Opening a folder turns each file into a note: path, purpose, comments and docstrings, exports, symbols (HTTP routes, Tauri commands, constants) and links between files, including from a server route to the Rust or React code that calls it.
- You can add your own notes with `->@name` links, `?about:` lines, checklists and tags. Rescans never change them.
- The notes are shown as a graph, and the lead agent and the chat get a compact map built from them.

### Costs
- After each run you get a table of tokens and money per agent: new input, cache reads, output, and dollars where the CLI reports them. Reused blocks are marked as free.
- The sidebar shows your current Claude and Antigravity plan limits.
- Claude reports dollars; DeepSeek and Antigravity report only tokens.

## Limits of the evidence

The project map does not make an agent more accurate. We tested a compact map, hooks that pass it to Claude Code, a graph tool server and semantic search on bug fixes, a noisy monorepo, cross-module bugs, multi-file questions and 208 pre-registered questions on large repos. None of it beat plain grep, so it was removed. The savings in the benchmark come from how the orchestra calls the models. Scripts and raw results are in [`archive/map-bench/`](archive/map-bench/README.md).

## Build from source

```bash
npm install
npm run tauri dev          # run the app
npm test                   # TypeScript tests
cd src-tauri && cargo test # Rust tests
npx tauri build            # installer (unsigned)
```

You need the CLIs of the agents you plan to use (`claude`, `agy`), signed in, and `git` for isolation. DeepSeek, OpenRouter, NVIDIA and the Gemini image models need an API key in Settings.

## Known limits

- One worktree per orchestra, shared by the agents inside it. It starts from `HEAD`, so uncommitted work is not included.
- The installer is unsigned and there is no auto-update. Only the Windows build has been tested; CI for Linux and macOS exists but has not run yet.
- Codex is wired in the backend but hidden in the menu. NVIDIA answers arrive in one piece, not streamed.
- A rescan still walks the whole folder and compares every note with the one on disk (about 0.4 s and 0.25 s on Django). The scanner's cache is lost when the app closes, so the first scan after launch is a full one.
- A file edited in the last two seconds is always re-read, because a coarse file clock could hide the next edit.
