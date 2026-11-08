# v5 results: what cut tokens, what did not

Real `claude -p` runs on `claude-haiku-5-5`, numbers from the API usage report. n is small (see each row); treat differences under ~10% as noise.

## Where the tokens went at session start (one trivial prompt, Read tool only)

| Setup | Input tokens per call |
|---|---|
| Claude Code as is (claude.ai connectors: Figma 43 tools, Claude Docs) | ~51,000 |
| `ENABLE_CLAUDEAI_MCP_SERVERS=false` in `.claude/settings.local.json` | ~7,600 |
| same, in `.claude/settings.json` | no effect (still ~51,000) |

`node mcp/setup.mjs <project> <graph dir>` writes the working file. Cost: Figma and Docs are not available in that project (`--keep-connectors` skips this).

## Skills: always-loaded list vs graph hint (`bench/skills.mjs`, 14 prompts, 1 run each)

| Mode | Tokens per call | Right skill |
|---|---|---|
| base | ~54,800 | 13/14 |
| connectors off (skills still listed) | ~16,500 | 13/14 |
| connectors off, skills off, graph hint (top 3) | ~6,400 | 12/14 |

The first hint rule ("only when sure") scored 7/14 and was replaced by "always top 3". Both misses answered `ponytail` for `ponytail-review`.

## Retrieval changes in this version

Offline recall of the expected files in the top k (`bench/rank.mjs`, no API):

| Set | recall@5 without folder spread | with spread |
|---|---|---|
| NovaFull held-out (30 q, 836 notes) | 0.967 | 0.967 |
| NovaFull impact (8 q, lists of files) | 0.408 | 0.640 |
| Armyx (10 q) | 0.900 | 0.900 |

Spread (max ~k/3 hits per folder while others wait) does not change single-answer questions and helps list answers; it is on by default.

End to end on NovaFull (graph from the new scanner, hits delivered by `mcp/claude-hook.mjs`):

| Set | Mode | Correct | Cost | Turns | Input tokens |
|---|---|---|---|---|---|
| held-out, 30 q x 1 | alone | 28/30 | $0.0601 | 105 | 1,037,929 |
| held-out, 30 q x 1 | hook | 30/30 | $0.0386 | 75 | 793,074 |
| impact, 8 q x 2 | alone | 16/16 | $0.0354 | 72 | 565,843 |
| impact, 8 q x 2 | hook | 16/16 | $0.0318 | 67 | 542,555 |

Held-out: -36% cost, -29% turns. Impact: -10% cost, recall already 1.00 for both (ceiling).

## Did not help

- **Read gate** (deny a whole-file Read of a big file, `readgate` in the hook): on a 29 KB file it added 1-2 turns (3-4 instead of 2) and 31-36k input instead of 28k, with no cost saving. Left in the hook, marked not recommended, off by default.
- **caveman on top of ponytail**: not installed; both cut output tokens only, and ponytail's own benchmark has them at parity (-2%).
- **ponytail map next to ours**: ponytail's map is ~360 characters; no real duplication.

## What this version adds

- `~` before a file in `?calls` / `?callers` marks a link guessed by symbol name; links from import lines, routes and commands come first in the hits (idea taken from graphify's EXTRACTED / INFERRED).
- `?schema: 2` in project-map and a warning when a graph came from an older scanner.
- Unreadable or empty notes are skipped instead of crashing the hook or server (`mcp/load.mjs`).
- `mcp/watch.mjs`: rescan 3 s after the last change; the scan example now deletes notes of removed files.
- `mcp/setup.mjs`: one command for hooks (no matcher, so `/compact` brings the map back) plus the connector switch.
- `mcp/gateway.mjs`: two tools in front of many stdio MCP servers (not measured on real connectors; HTTP connectors unsupported).
- `mcp/tools-to-notes.mjs` + prompt hook: skills as notes, hinted per prompt.

## Not done

- Call-graph second pass over an AST (graphify's `INFERRED calls`): needs a parser per language, bigger than this change.
- A real graphify run: its install executes a third-party package from the internet; not run here.
- Gateway and skill hints on other models or on more than 14 prompts.
