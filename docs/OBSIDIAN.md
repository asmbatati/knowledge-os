# The Knowledge OS in Obsidian

The plugin (`obsidian-plugin/`, id `knowledge-os`) puts the site beside your notes. It needs Obsidian 1.13.2 or later
on a desktop (it starts a Python process, which a phone cannot).

## Install

Until it is in Obsidian's community directory:

1. From the latest release, download `main.js`, `manifest.json` and `styles.css`.
2. Put them in `<vault>/.obsidian/plugins/knowledge-os/`.
3. In Obsidian: Settings → Community plugins → turn on **Knowledge OS**.

With BRAT, add this repository and it installs the latest release. To build it yourself:
`cd obsidian-plugin && npm install && npm run build`.

If the vault used **Learning Road** (`vault-exam`), the plugin takes its settings once (the site's address, the road
folder, today's road note, and the folders where *mark as read* applies). Turn Learning Road off: this plugin does
everything it did.

## First run

1. Open the plugin's settings. If the vault carries the site in `x/apps/knowledge-os/`, leave **Site folder** empty;
   otherwise point it at the folder that holds `server.py`.
2. Press **Connect**. The plugin starts the site and shows its log. If Python lacks a package, the message says what
   to install (`python -m pip install markdown pyyaml`).
3. Under **Model**, choose a provider and a model, then **Save model**. **Check the tool** says whether Claude Code,
   Codex or Ollama is installed and ready.
4. For an API provider, link its key under **API keys** (see below). A key reaches the site only when it starts, so the
   plugin restarts a site it started as soon as a key changes.
5. Press **Run the tests**: a model grades only after it passes the grader test (about 60 calls; the page says the cost
   first).

## Settings

| Setting | What it does |
|---|---|
| Address | where the site listens; `http://127.0.0.1:4190` by default |
| Start the site automatically | start it when it is not running; it stops when Obsidian closes |
| Site folder | the folder of `server.py`; empty means `<vault>/x/apps/knowledge-os` |
| Python | the interpreter; empty means `python` (Windows) or `python3` |
| Open the site in | an Obsidian tab, or your browser |
| Provider, Model, Reasoning effort, Daily budget | the site's model, saved in its `knowledge-os.json` |
| API keys | Anthropic, OpenAI, Gemini, OpenRouter, a custom server |
| Road folder, Today's road note | where the day's road plan is read for the status bar |
| Where mark as read applies | folder prefixes, comma separated; empty means everywhere |

**Keys.** Each key is a secret setting: Obsidian keeps the key in its keychain and the plugin's settings file holds only
the secret's name. The plugin hands a key to the site in its environment when it starts it, and nowhere else.

**A site started another way** (at logon, from a terminal, from another tool) is used as it is and never stopped. Its
model is changed on its own Settings page, which the plugin opens for you, because only a site the plugin started
accepts the plugin's writes.

## Commands

| Command | What it does |
|---|---|
| Open today | the site's Today |
| Study session | a coached session |
| Choose the model | the site's Settings page |
| Check this concept | the open note's road check |
| Teach this note | Teach, on the open note |
| Explore this note | the open note in Explore: its dates, relations and place |
| Place me toward this goal | placement toward the open note |
| Mark this note as read | writes `read_on` (today) and `read_count`, on your click |
| Start the site, Stop the site | stop only acts on a site the plugin started |

The note commands show only when a Markdown note is open; *mark as read* only inside its folders. The ribbon's compass
and the status bar open Today.

**The status bar** shows the day's road: 🧭 due · ready · to read from the road plan, ✓ the verdicts recorded today,
🔥 the streak while the site is running.

## In a tab

The tab frames the site's pages with their header hidden. A note's **Open in Obsidian** opens the note in a new tab. The
tab's buttons reload it or open the same page in the browser. The tab remembers its page across restarts.

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| "Set Site folder…" | no `server.py` in the setting or in `x/apps/knowledge-os`: set the folder |
| "Python cannot run the site" | install what the message names, or set **Python** to an interpreter that has it |
| "The Knowledge OS stopped while starting" | the last lines of its log follow; a port already in use is the usual one: change **Address** |
| "Only a site on this machine can be started" | the address is not `127.0.0.1` or `localhost`; the plugin starts only a local site |
| "no model grades your answers" | no model chosen, not trusted yet, or out of reach (no CLI, no key, today's budget spent, the Claude plan's quiet hours) |
| The tab is blank | the site must allow Obsidian to frame it: update the site to 0.8.0 or later |
| Obsidian's hotkeys do nothing in the tab | the keys go to the framed page while it has the focus: click the tab's title or the sidebar first |

The site exits by itself when Obsidian goes away, so a crash leaves no process behind.
