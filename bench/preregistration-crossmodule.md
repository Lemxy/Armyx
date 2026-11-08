# Pre-registration: does the graph help with bugs that cross modules and languages?

Written before any run of this experiment (generator and tasks exist, no agent has seen them).

**Hypothesis.** When a bug's symptom appears in one place (a Python command-line client or a web client) and its cause is in another
module or language, reachable only through a contract (an HTTP route string) or through a shared library, an agent that has the graph
(map plus best matches, or graph tools) needs clearly fewer turns than an agent that explores with grep, without fixing fewer bugs.

**Setup.** `bench/gen-polyglot.mjs` writes a shop app: Node server (route, rules and shared money library per feature), a Python
command-line client and a web client per feature, integration tests that start the server and call both clients. 8 injected bugs
(`bench/edit-tasks.polyglot.json`), symptom written as a user would, no file or function names. Modes: `alone-terse` (baseline),
`map-v3-terse`, `map-v4`. 3 repeats per bug and mode, paired by bug and repeat. Primary metric: turns. Secondary: cost per fixed bug, bugs fixed.

**Supported if** against the baseline, for a graph mode: paired mean difference in turns is at most -1.0 (and t <= -2), the mode fixes at most
1 bug fewer out of 24, and cost per fixed bug is not more than 5% higher.
**Refuted if** the difference is -0.5 turns or smaller in size, or cost per fixed bug is higher. Anything in between is inconclusive.
Two graph modes are compared with one baseline, so a result counts only with t <= -2.2.

**My own expectation, written down:** I give map-v3 about a 20% chance of being supported and graph tools about 30%. On every earlier
benchmark here the saving was about one turn or less and did not show up in cost.

## Result (added after the run)

24 pairs per comparison, baseline `alone-terse`. Map v3: -0.58 turns (t -2.0), cost per fix -12%, not supported at the bar (needed <= -1.0 and
t <= -2.2) and not refuted: inconclusive. Graph tools v4: +3.25 turns (t 5.7), cost per fix +31%: refuted. All modes fixed 24 of 24.
In the traces `neighbors` was used in 3 of 24 graph-tool runs and `impact` in none.

## Follow-up (written before the run): does a stronger instruction make graph tools use the graph?

In the first run the agent used `find` everywhere but `neighbors` in 3 of 24 runs and `impact` in none, so the links were not exercised.
New mode `map-v4-nudge`: same tools, but the instruction tells it to call `find` once, then `impact` on the best file (which lists the
route, the rules and the shared libraries within two links), read only those files, edit, and not search the project with grep.
Same 8 bugs, 3 repeats, paired with `alone-terse` run again in the same batch (and the old `map-v4` for comparison).

**Supported** if `map-v4-nudge` uses `impact` in at least half of the runs, saves at least 1.0 turns against `alone-terse` (t <= -2),
fixes at most 1 bug fewer out of 24, and does not raise cost per fixed bug by more than 5%. **Refuted** if it saves 0.5 turns or less,
or cost per fix is higher. My expectation: about 25% chance of support.

### Follow-up result (added after the run)

72 runs, 24 pairs against `alone-terse` in the same batch. `map-v4-nudge` called `impact` in 24 of 24 runs (so the first condition held), and all
modes fixed 24 of 24, but it needed 3.21 more turns than the baseline (t 7.6), cost $0.0004 more per task (t 3.5) and was 3.1 s slower.
**Refuted.** The old `map-v4` was 2.33 turns worse than the baseline in this batch. With `impact` the agent read 3.2 files per bug (the
whole chain client, route, rules, shared library) instead of going straight to the one it needed.
