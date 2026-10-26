# Knowledge OS for Obsidian

Study your vault's learning road beside your notes. The plugin shows the [Knowledge OS](../README.md), a local study
site, in an Obsidian tab or your browser: today's reviews and checks, a coach that teaches a concept from your own note
before it asks, Explore, Teach and the Lab. Your answers are graded by the model you choose: your Claude or ChatGPT
subscription, an Anthropic, OpenAI, Gemini or OpenRouter key, or a model on your machine through Ollama.

- **Starts and stops the site** with Obsidian, from the copy your vault carries in `x/apps/knowledge-os/` or a folder
  you name. A site already running is used as it is and left alone.
- **Keys stay in Obsidian's keychain**, handed to the site only when the plugin starts it. They are never written to a
  file.
- **The day's road in the status bar**: what is due, ready and to read, the verdicts recorded today, the streak.
- **Commands on the open note**: check this concept, teach it, explore it, place yourself toward it, mark it as read.

Desktop only (it starts a Python process). It needs Obsidian 1.13.2 or later, Python 3.11 or later with Markdown and
PyYAML, and a vault with the learning road's scripts.

Setup, settings, commands and troubleshooting: [docs/OBSIDIAN.md](../docs/OBSIDIAN.md).

## Privacy

The plugin talks only to the site on `127.0.0.1`. The site sends the text of a question, its key and your answer to
the model you chose, on your account, and nothing else anywhere; a local model sends nothing. No telemetry.

## Develop

```
npm install
npm run build     # type-check and bundle main.js
npm run lint      # eslint-plugin-obsidianmd
npm test          # unit tests, the bundled plugin on a stubbed obsidian, end to end against server.py --demo
```
