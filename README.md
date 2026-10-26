# Knowledge OS

A local study site for an Obsidian vault's **learning road**: a graph of concepts, each resting on the ones it needs,
walked one checked concept at a time. It opens on what is due today, teaches a concept from your own note before it
asks about it, checks you with three questions (define it, use it, say why), and records a verdict only when you pass
or miss. It also has a coach, a lab of models and exercises, a course tutor, Explore (a field's history and frontier)
and Teach (you explain, a model plays the student).

It runs on your machine, binds `127.0.0.1` only, and writes no note: its verdicts and ledgers go to files the vault's
own scripts read. It grades with the model you choose, on your own plan or key, and only after that model has passed
the grader test.

## What it needs

- **A vault with the learning road**: the road's scripts in `x/scripts/` (`_road.py`, `_road_graph.py`,
  `_road_bank.py`, `_learning.py`, `_knowledge.py`) and concept notes with `requires:` lists. The template edition of
  the vault ships them, with this site in `x/apps/knowledge-os/`.
- **Python 3.11 or later**, with Markdown and PyYAML: `python -m pip install markdown pyyaml`.
- **A model, if you want answers graded** (or grade them yourself against the key): see [Providers](#providers).

## Run

```
python server.py                     # the vault this folder sits in (x/apps/knowledge-os), on http://127.0.0.1:4190
python server.py --vault "<vault>" --port 4190
python server.py --demo --port 4191  # a temporary demo vault: nothing of yours touched
python server.py --selftest          # every check, with fake models: no call leaves the machine
```

Settings live in `knowledge-os.json` beside `server.py`: the vault, the port, the provider and model, the reasoning
effort, a daily budget for pay-per-use models, the quiet hours, the timer. The site's own **Settings** page changes the
model. No API key is ever written there.

## In Obsidian

The [Knowledge OS plugin](obsidian-plugin/) shows the site in an Obsidian tab (or your browser), starts it when it is
not running and stops it when Obsidian closes, keeps your API keys in Obsidian's keychain, shows the day's road in the
status bar, and adds commands to check, teach, explore or place yourself on the open note. See
[docs/OBSIDIAN.md](docs/OBSIDIAN.md).

## Providers

| Provider | How it is paid | What you set up |
|---|---|---|
| Claude subscription (Claude Code) | your Claude Pro or Max plan | install Claude Code, run `claude` once and sign in |
| ChatGPT subscription (Codex) | your ChatGPT Plus or Pro plan | `npm install -g @openai/codex`, then `codex login` |
| Anthropic API | per token | `ANTHROPIC_API_KEY` |
| OpenAI API | per token | `OPENAI_API_KEY` |
| Google Gemini | free tier, then per token | `GEMINI_API_KEY` |
| OpenRouter | free models, then per token | `OPENROUTER_API_KEY` |
| Ollama | runs on your machine | install Ollama and pull a model |
| Any OpenAI-compatible server | as it charges | `custom_base_url` and `custom_model` in `knowledge-os.json` |

The subscriptions run through their own command-line tools, headless, in an empty folder, with no tools and no MCP
servers, the prompt on stdin. Every API key is taken out of the tool's environment, so a plan is never silently
swapped for API billing. Details, limits and measured results: [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Trust

A model grades your answers only after it agrees with the key on every case of `tests/grader-cases.json`, and plays
the student in Teach only after it finds what `tests/teach-cases.json` plants. Run the tests from the Settings page or:

```
python server.py --grader-test --provider claude-cli --model sonnet
python server.py --teach-test --provider ollama --model qwen3.6:27b
```

A pass is kept per provider and model in `.local/trust.json`, and a change to the grading prompt voids it. Until a
model passes, you grade against the key yourself, and the page says why.

## Privacy

- Nothing is sent anywhere except the text of a question, its key and your answer, to the model you chose, on your
  account. A local model sends nothing.
- No telemetry, no account, no analytics.
- Keys stay in your environment or Obsidian's keychain; the site never writes one to a file, a ledger or a log.
- The pages may be framed only by the site itself and by Obsidian. Every write needs the page's token and the site's
  own origin, or the secret of the Obsidian plugin that started it.

## Layout

```
server.py              the entry point
knowledge-os.json      settings (never a key)
los/                   the server: app.py (API), web.py (HTTP), grade.py, banks.py, coach.py, teach.py, tutor.py,
                       explore.py, providers/ (every model), trust.py, watchdog.py, selftest*.py
web/                   the page: plain HTML, CSS and ES modules, no build step; KaTeX and Mermaid vendored
figures/               interactive figures, each its own page
tests/                 the grader and Teach test sets; the page's Node tests
obsidian-plugin/       the Obsidian plugin
skill/                 a claude.ai skill that carries a study session to the phone and back
docs/                  PROVIDERS.md, OBSIDIAN.md
```

## License

See [LICENSE](LICENSE). The Anatomy figure kit in `figures/kit/` and the coach's card format keep their own MIT
notices; KaTeX, Mermaid and the Cairo font keep theirs.
