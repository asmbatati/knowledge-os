# Changelog

## 0.8.1, 26 Oct 2026: the coach, after the owner's first sessions

- **The teach-back names its concept**, one of the lessons actually taken (the one being taught, else the last), and
  the learner may pick another. Stopping as a new lesson opened had judged a teach-back of Power sets against
  Relations, a lesson never read; the session's end and the lecture note now list only lessons taken.
- **Explain more** on every step of a lesson (button or E): the same idea again, another way, with a new example and
  an answer to what the learner asks; never the step's answer. Three a step.
- **The timer's notices stay until answered**: when the focus ends, the break has started (OK, or skip it); when the
  break ends, Start the next focus or Stop for today. A nine-second toast had been the only sign, and after the break
  there was no way to start again outside the Focus page.
- **A step only read is recorded**, so a lesson without questions counts as taken.
- **Teach's test has twelve sessions**, eight added on the owner's review.

## 0.8.0, 26 Oct 2026: any model, and the Obsidian plugin

- **Any model, behind one interface** (`los/providers/`): the Claude and ChatGPT subscriptions through Claude Code and
  Codex, run headless with no tools and no API key in their environment; the Anthropic and OpenAI APIs, Gemini,
  OpenRouter, Ollama and any OpenAI-compatible server, on the standard library. The grader, the bank writer, the tutor,
  the coach and Teach share one model.
- **Trust per provider and model**: a model grades only after it passes the grader test and plays Teach only after the
  Teach test, on the prompts of the day; the result is kept in `.local/trust.json`.
- **A daily budget** for pay-per-use providers, and a `usage` ledger of counts and dollars, never text. The quiet hours
  bind the Claude plan alone.
- **Settings page**: choose the provider, the model and the effort, check the tool, run the tests with their cost said
  first.
- **Claude Code 2.1 and later** (a native `claude.exe`, no `cli.js`) are found and used; before, grading had silently
  fallen back to self-grading.
- **In an Obsidian tab**: pages may be framed by Obsidian alone; `?embed=1` hides the header and a note link asks
  Obsidian to open the note.
- **The Obsidian plugin** (`obsidian-plugin/`, 1.0.0): the site in a tab or the browser, started and stopped with
  Obsidian, keys in Obsidian's keychain, the road in the status bar, commands on the open note, *mark as read*.
- **The site stops with its parent**: a site the plugin started exits when Obsidian goes away or its output pipe
  breaks; any other site keeps serving, on its log file.

## 0.7.0, 24 Oct 2026: the road, coached

A check taught before it is asked; "I don't know"; placement steps past a concept with no bank.

## Earlier

0.6.0 and 0.5.0 (20 Oct 2026), the study coach; 0.4.1 (19 Oct), notes in the page's language; 0.4.0 (9 Oct), Teach;
0.3.0 (8 Oct), Explore; 0.2.0 (2 Oct), the course tutor; Learning OS 2 (1 Oct), the road as a graph and the Lab;
0.1.0 (29 Sep 2026), the first site.
