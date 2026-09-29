# Agent evaluation harness

Measures **pass/fail, steps, tokens and cost per task** for the agent loop, so
changes to it can be judged instead of argued about. Phase 0 of #1197, under
#772.

Separate from the `benchmarks/` boot suite, which keeps measuring startup and
packaging and is untouched by this.

## Running it

```bash
pnpm run build                       # the harness measures dist/cli.js
pnpm run test:agent-eval             # every fixture, 5 runs each
pnpm run test:agent-eval -- --fixture single-file-edit --runs 1
pnpm run test:agent-eval -- --model qwen3:8b --provider ollama
pnpm run test:agent-eval -- --cli ../nanocoder-1.29.0/dist/cli.js
```

It is deliberately **not** part of `pnpm run test:all`: it needs real model
calls and takes minutes per run.

| Flag | Meaning |
| --- | --- |
| `--cli <path>` | CLI to measure. Defaults to this checkout's `dist/cli.js`; point it elsewhere to measure a released tag with this same harness. |
| `--runs <n>` | Runs per task. Defaults to 5; the median and IQR come from these. |
| `--model`, `--provider` | Passed through to the CLI. Also read from `NANOCODER_AGENT_EVAL_MODEL` / `NANOCODER_AGENT_EVAL_PROVIDER`. |
| `--fixture <name>` | Run one task only. |
| `--out <path>` | Results file. Defaults to `benchmarks/agent/results.json` (gitignored). |

## Model tiers

- **Local (required)**: an Ollama model any contributor can reproduce. Pin the
  same model and temperature across the runs being compared.
- **Cloud (optional)**: any configured provider, via `--provider` / `--model`.

Cost comes from `source/usage/`, which prices provider-reported tokens through
models.dev and bills cache reads and writes at their own rates. A local model
has no published price, so cost reads `—` rather than `$0.00`.

## Fixtures

Each directory under `fixtures/` is one task: a vendored project tree, a
`task.json` holding the prompt, and machine-checkable assertions. Vendored
rather than cloned, so runs are reproducible, offline, and immune to upstream
drift.

Every fixture carries distractors — a similarly named neighbour, a second
timeout constant, a sender-shaped helper outside the target directory — so a
run working from stripped or degraded context fails an assertion rather than
merely finishing cheaper. A token count alone cannot catch that.

| Assertion | Checks |
| --- | --- |
| `file-contains` / `file-not-contains` | A path's contents after the run. |
| `final-text-matches` | The model's answer, as a case-insensitive regex. |
| `files-unchanged` | Nothing was written during a read-only task. |
| `command` | A command (`node --test`, a verify script) exits 0 in the workspace. |

Runs happen in a throwaway copy of the tree, so a task can edit freely and the
vendored fixture is never touched.

Every result records `fixturePackId` and a content hash of the whole fixture
set, so a fixture edit can never be mistaken for a change in the agent. Bump
`FIXTURE_PACK_ID` in `harness.ts` when a fixture changes.
