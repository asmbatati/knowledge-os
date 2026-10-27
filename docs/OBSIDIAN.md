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

## The progress block

A note can show where you stand on the concepts it names, live (plugin 1.1, site 0.9):

````markdown
```knowledge-os
progress
teaches: teaches
assumes: prerequisites
```
````

The two lines name the frontmatter properties that list the note's concepts as links; without them the block reads
`teaches` and `prerequisites`. [paper2chapter](https://github.com/serrysibaee/paper2chapter) writes this block into
each chapter when its Knowledge OS integration is on.

- **What it assumes** and **what it teaches**, each with how many stand. Each concept is a link to its note, with its
  status on the road: granted, provisional, passed, mastered, ready to check, to read again, locked, or not on the
  road. A concept it teaches that does not stand yet says how many of the concepts it rests on, itself included, still
  have to stand.
- **Buttons by status**: *Check* and *Teach me* when it is ready or to be read again, *Teach me* and *Place me* when it
  is locked, *Explore* when the road does not hold it.
- It is drawn again when the road's files change, when the note's properties change, and every five minutes.
- It **writes nothing** and **never starts the site by itself**. When the site is not running it says so, with a
  *Start the site* button; a site older than 0.9 has no standing to give, and the block says to update it.

## For other plugins

Another plugin can ask where its reader stands, through `app.plugins.plugins['knowledge-os'].api` (version 1):

```ts
api = {
	version: 1,
	// the standing of concepts by note name; a name the road does not hold is left out, so your own rules decide it
	status(names: string[]): Promise<Record<string, {
		note: string; state: string; stands: boolean; layer: number; to_stand: number; of: number;
	}>>,
	// the site's page for a concept: 'check' | 'teach' | 'place' | 'explore'
	open(action: string, concept: string): void,
};
```

- `state` is the road's: `granted`, `provisional`, `passed`, `mastered` (these stand), `ready`, `to-read`, `locked`.
  `stands` also checks that everything the concept rests on stands. `to_stand` of `of` counts the concepts of its
  closure, itself included, that do not stand yet.
- `status` asks the site and **never starts it**: when the site is not running the promise rejects, and you fall back
  on what you know. At most 200 names a call.
- `open` shows the page in the plugin's tab or the browser, starting the site as the commands do.
- Check `api.version >= 1` and that `status` is a function before using it: an older Knowledge OS has no `api`.

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
| A progress block says the site is older than the plugin | the site has no standing to give: update it to 0.9.0 or later |
| A progress block's concept says "not on the road" | the road's graph does not hold that note (no `requires:` or `axiom:`), or the property links a note of another name |

The site exits by itself when Obsidian goes away, so a crash leaves no process behind.
