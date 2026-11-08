# Preregistration: does the map plus semantic search make an agent more accurate on big repos?

Written before any run of the LLM benchmark below (the offline calibration comes first and is described here too).

## Hypothesis
On a big repo (Django, 3,408 notes) and questions a person would ask (reworded, sharing no 5+ letter word with the code), an agent that gets
Armyx's best matches through the Claude Code hook finds the right file more often than one exploring alone, and the hybrid ranking (word match
plus local embeddings) does so more than the word match alone, at no more than +10% cost per correct answer.

## Questions
About 200 fresh questions: `bench/genq.mjs` on Django with a new seed (11), then `bench/paraphrase.mjs` (haiku rewrites the docstring). Not the 40
reworded questions used so far. One run per question and mode.

## Modes (model claude-haiku-5-5, tools Read/Grep/Glob, no user MCP servers, warmed cache; as bench/bench.mjs)
- alone: no help.
- hook-bm25: the real product path, `deso-vault --armyx-hook` (SessionStart + UserPromptSubmit), graph without vectors. On a big project that
  means: no map, best matches only when the word match is "sure".
- hook-hybrid: the same, with the vectors (semantic search on). The hybrid must be able to speak when the word match is unsure, so it has its
  own sureness rule, **calibrated offline on the old question sets only** (the 40 plain and 40 reworded Django questions, this repo's 10 + 16)
  and then frozen. The new 200 questions are not used for calibration.

## Measures
Correct (answer contains the expected path), cost per correct answer, turns, seconds. Paired by question.

## Sample size
Detecting +10 points on a paired design with about 25% discordant pairs needs about 190 questions (80% power, alpha 0.05). My own estimate.

## Decision rule (frozen now)
- Supported: hook-hybrid beats alone by >= 8 points of correct answers (McNemar, p < 0.05) and its cost per correct answer is <= alone's + 10%.
- Hybrid specifically helps: hook-hybrid beats hook-bm25 by >= 5 points, same cost bound.
- Otherwise: no accuracy case for the map on big repos. Stop retrieval work; the product is the orchestra, the isolation and the graph as notes,
  not token savings.

## My expectation (before running)
Probably not supported. The reworded Django questions were close to unsolvable by retrieval alone (top 12: 0.13 words, 0.15 hybrid), so the
hook will mostly stay silent or show wrong files; the earlier 120-run test gave +7 correct, p about 0.09.

## Result (208 questions: 58 fresh Django + 150 standard library; haiku, one run per question and mode)

| | alone | hook-rs (words) | hook-rs-sem (hybrid) |
|---|---|---|---|
| correct | 170/208 (81.7%) | 168/208 (80.8%) | 166/208 (79.8%) |
| cost per correct answer | $0.0040 | $0.0040 | $0.0038 |
| turns / seconds | 6.47 / 19.1 | 6.44 / 19.2 | 6.18 / 18.5 |

Paired: hybrid vs alone -1.9 points (10 questions only the hybrid solved, 14 only alone; McNemar p = 0.54; about 95% interval -6.5 to +2.7 points);
hook (words) vs alone -1.0 point (p = 0.83); hybrid vs hook (words) -1.0 point (p = 0.83). Cost per correct answer: hybrid -4.7% against alone
(not significant, not part of the rule). Django alone: 55/58, stdlib alone: 115/150.

Verdict by the frozen rule: **not supported** (needed +8 points with p < 0.05; got -1.9), and the hybrid does not beat the hook on words alone
(needed +5; got -1.0). The data also rule out a gain above about +3 points at this sample size. Per the rule: no accuracy case for the map on big
repos; stop retrieval work.

Caveats: one model, one run per question; Django and the standard library are in the model's training data, which favours "alone"; how often the
hook actually showed hits was not logged; all questions are "find the file", not edits.
