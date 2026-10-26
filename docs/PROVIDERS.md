# Providers

The site asks a model to grade an answer against its key, to write a check bank from a note, to teach a lesson, and to
play the student and the reviewer in Teach. One model does all of these: the one chosen in `knowledge-os.json`
(`provider`, `model`), on the Settings page, or in the Obsidian plugin. A model is used for grading only after it passes
the grader test, and for Teach only after the Teach test (see [Trust](#trust)).

## The providers

### Claude subscription (Claude Code), `claude-cli`

Your Claude Pro or Max plan, through Claude Code. Install it, run `claude` once and sign in. Models: `sonnet`, `opus`,
`haiku`. There is no per-token bill; the plan's usage limits apply.

How it runs: the native `claude` (Claude Code 2.1 and later) or `node cli.js` (older npm installs), found on the path or
through `claude_cli` in `knowledge-os.json`, as `claude -p --output-format json --model <m>` in an empty temporary
folder, with every tool disallowed, an empty MCP configuration (`--strict-mcp-config`), project settings only, and the
prompt on stdin. Every API key is removed from its environment, so Claude Code can only use your plan.

**Quiet hours**: 23:55 to 04:30 by default (`quiet_hours`), the Claude plan answers nothing and you grade yourself.
They exist for a vault whose night jobs share the same plan; `"quiet_hours": []` turns them off.

### ChatGPT subscription (Codex), `codex-cli`

Your ChatGPT Plus or Pro plan, through the Codex CLI: `npm install -g @openai/codex`, then `codex login`. Models:
`gpt-6.1-sol`, `gpt-6-luna`, `gpt-6-astra`, or `default` (whatever Codex chooses). The plan's limits apply.

How it runs: `codex exec --json --sandbox read-only --ephemeral --ignore-user-config -o <file>` in an empty temporary
folder, the prompt on stdin, API keys removed from its environment. The Settings page's **Check the tool** asks
`codex login status`.

### Anthropic API, `anthropic`

Per token, with `ANTHROPIC_API_KEY`. Models and prices per million tokens (input / output): `claude-haiku-5-5`
$0.10 / $0.50, `claude-sonnet-5-5` $2 / $10, `claude-opus-5-5` $4 / $20.

### OpenAI API, `openai`

Per token, with `OPENAI_API_KEY`. `gpt-6-luna` $0.10 / $0.50, `gpt-5.4-mini` $0.75 / $4.50, `gpt-6.1-sol` $2 / $10.

### Google Gemini, `gemini`

`GEMINI_API_KEY` from Google AI Studio, through Gemini's OpenAI-compatible endpoint. A free tier, then per token:
`gemini-3.8-flash` $0.75 / $3.75, `gemini-3.5-flash-lite` $0.30 / $2.50. Google may use free-tier prompts to improve
its products: your questions and answers would be among them.

### OpenRouter, `openrouter`

`OPENROUTER_API_KEY`. The listed models are free ones (`nvidia/nemotron-3.5-super-vl:free`,
`google/gemma-4-31b-it:free`), with their rate limits; any other OpenRouter model id can be typed in.

### Ollama, `ollama`

A model on your machine: install Ollama, `ollama pull qwen3.6:27b` (or `gpt-oss:20b`, `gemma4:12b`), keep it running.
Nothing leaves the machine. `ollama_base_url` sets the address (`http://127.0.0.1:11434/v1`).

### Any OpenAI-compatible server, `custom`

`custom_base_url` and `custom_model` in `knowledge-os.json`, and `CUSTOM_OPENAI_API_KEY` if it wants a key: LM Studio,
vLLM, a hosted gateway.

## Keys

The site reads a key from its environment and never writes one: not to `knowledge-os.json`, a ledger or a log. Set it
in the shell that starts the site, or let the Obsidian plugin hand it over from Obsidian's keychain when it starts the
site. The usage ledger (`x/reports/learning/los/usage-YYYY-MM.jsonl`) keeps, per call, the provider, the model, the
purpose, the token counts and the price: never a prompt or an answer.

## Budget

`daily_budget_usd` (1.00 by default) stops a pay-per-use provider for the rest of the day once its priced calls reach
it; you grade yourself until midnight. A subscription and a local model are not metered.

## Trust

A model grades only while it agrees with the key on every one of the 60 cases in `tests/grader-cases.json` (right and
wrong answers, borderline ones included), and plays Teach only while it finds what the twelve sessions of
`tests/teach-cases.json` plant (an error, jargon, a missing example, an unchecked student). Run them on the Settings
page, from the plugin, or:

```
python server.py --grader-test --provider <id> --model <model>
python server.py --teach-test --provider <id> --model <model>
```

The result goes to `tests/grader-results-<date>-<provider>-<model>.json` and the pass to `.local/trust.json`, with a
hash of the prompts: a change to a prompt voids every pass until the test is run again.

### Measured, 26 Oct 2026

| Provider | Model | Grader (60) | Teach (4), two runs | Time, cost |
|---|---|---|---|---|
| Claude subscription | Claude Haiku | 60, trusted | 3, then 2 | about 6 min; the plan (Claude Code reported $0.05) |
| Claude subscription | Claude Sonnet | 59, not trusted | 3, then 4 | about 7 min; the plan (reported $0.19) |
| ChatGPT subscription | GPT-6 Luna | 60, trusted | 3, then 3 | about 7 min; the plan |
| ChatGPT subscription | GPT-6.1 Sol | 60, trusted | 3, then 3 | about 10 min; the plan |

**Teach on twelve cases** (the owner's decision the same day: four were too few to trust): GPT-6.1 Sol 11, GPT-6 Luna
9, Claude Sonnet 9, Claude Haiku 7; none trusted yet. Nearly every miss is a reviewer finding a fault that is not there:
an error in a bare but correct statement, or a missing example where one was given.

Sonnet's one disagreement was a strict reading: asked why *chance* is an axiom, it refused "we judge how likely things
are from experience before any measuring, and probability is defined to fit that judgement", which the set counts as
right. Every Teach miss was a reviewer calling correct teaching an error, most often the bare but correct statement of
Moravec's paradox. The same model finds a different number of the four from run to run, and the trust file keeps the
latest run, so a Teach pass on four cases is not yet a stable measure. Sonnet passed all four on 9 Oct 2026.

## Terms

Each provider's terms apply to what you send it. Using your own Claude or ChatGPT plan through its own official CLI, for
your own study, is what those CLIs are for; the site does not share an account, resell access or run anything on
another person's plan. Check your provider's terms if you are unsure, and prefer a local model for anything you would
not send to a cloud service.
