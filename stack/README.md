# MorphArray Stack

![MorphArray](https://morpharray.github.io/morpharray/morpharray_256.png)


**VS Code extension for Mental Stacks and static “book” sites from HTML articles**

MorphArray Stack helps you keep **HTML articles** as the source of truth, build a **linked static site** under `dist/`, and copy **structured context** (Markdown) to the clipboard for LLMs — without editing your originals.

---

There's a full article series that explains the motivation behind this extension and shows how to use it to create rich, ordered context for LLM conversations.

→ [Read the Mental Stack Engineering series](https://morpharray.github.io/morpharray/stacks/stacks.html)

---

## Features

- **Initialize Book Workspace** — Scaffolds a new project in the opened folder (`defaults.json`, `stacks/book.mastack`, `articles/book/` starter pages, `templates/base.html` & `base.css`, `.gitignore` + `pasteboard_test.txt` for local paste tests).
- **Rebuild Dynamic Story** — You pick a `.mastack` file; the first line is the **index / landing** HTML (under `articles/`); remaining lines are **chapters**. Output mirrors paths under `dist/` (e.g. `dist/book/index.html`, chapter pages, and `base.css` beside the module).
- **Create Mental Stack (Full Context)** — Pick a stack file; the extension loads listed paths (first line = index, rest = chapters), applies the same **`# CHAPTER_START_INDEX`** as Rebuild, respects YAML frontmatter (with a forgiving fallback when titles contain colons), converts body HTML to **GitHub-flavored Markdown** (incl. tables via Turndown + `turndown-plugin-gfm`), and copies the bundle to the clipboard. **`<hr>`** in source becomes a `* * *` thematic break (not `---`) so downstream tools are less likely to treat the next lines as YAML frontmatter.
- **HTML-first workflow** — Write normal HTML (and optional frontmatter); the site builder does not modify `articles/`. Put **`name.jpg`** next to **`name.html`** under `articles/` and **Rebuild** copies it to `dist/` and fills `{{image}}` on that chapter page.
- **defaults.json** — Optional at the **workspace root** for placeholders such as `{{Author}}`, `{{Year}}`, `{{Byline}}`, `{{siteTitle}}`. If the file is missing, sensible defaults are used.

---

## Commands (Command Palette)

All commands appear under the **MorphArray** category (palette prefix `MorphArray:`).

| Command | What it does |
|--------|----------------|
| **Rebuild Dynamic Story** | Quick-pick a `.mastack` in `stacks/`, build static HTML into `dist/`. |
| **Create Mental Stack (Full Context)** | Quick-pick a `.mastack`, full Markdown stack → clipboard. |
| **Initialize Book Workspace** | Creates starter files in the **currently opened folder** (see above). |

Shortcut: **Ctrl+Shift+P** (Windows / Linux) or **Cmd+Shift+P** (macOS).

---

## Quick start (new book)

1. Open an empty folder in VS Code.
2. Run **MorphArray: Initialize Book Workspace**.
3. Edit **`defaults.json`**, **`stacks/book.mastack`**, and **`articles/book/index.html`** to match your project; add chapters as HTML under `articles/book/` and list them in the `.mastack` **after** the index line.
4. Run **MorphArray: Rebuild Dynamic Story** and choose your stack file.
5. Open generated pages under **`dist/`** (e.g. `dist/book/index.html`).

For Mental Stack copy/paste, run **Create Mental Stack (Full Context)** with the same `stacks/*.mastack` lists.

---

## Stack file format (`stacks/*.mastack`)

Plain text: one path per line (relative to `articles/`), `#` starts a comment, blank lines ignored.

- **Optional** — `# CHAPTER_START_INDEX=0` or `=1` (must be a non-negative integer). Controls numbering on the **index** chapter list only (built chapter pages use the article title as-is in `<title>` and the main heading). Default is **`1`** (list entries `1.`, `2.`, …). Use **`0`** if the first chapter should be `0.`, `1.`, … Only the first such directive is used. Numbers are plain decimals (no zero-padding).
- **Optional** — `# AUTHOR_NAME="Your Name"` (quotes optional) sets the author for **`{{Author}}`**, **`{{author}}`**, and **`{{Byline}}`** / **`{{byline}}`** when you run **Rebuild Dynamic Story**. If this line exists, it overrides `defaults.json` for that build; use `# AUTHOR_NAME=""` to omit the name from the byline (year only).
- **Optional** — `# LIBRARY_PATH="../../morpharray_library.html"` (quotes optional) — URL from the **built** index file (`dist/…/index.html`) to your library landing page. **Rebuild** appends a short **All books** link at the bottom of that index.
- **Optional** — `# ARTICLE_SERIES="Your Series"` (quotes optional) — fills **`{{ArticleSeries}}`** on chapter pages (same value for every chapter in that stack).
- **Line 1** — Index / landing page template (e.g. `book/index.html`) with a **`div.chapter-list`** where chapter links are injected.
- **Following lines** — Chapter HTML files, in order (navigation Prev/Next follows this order).
- **Per-line metadata** — After a path, optional `# key=value, key2=value2` (comma-separated, like CSS custom properties). Keys are lowercased and become template tokens: e.g. `{{something_else}}`. **`pub=`** (and **`date=`** if `pub` is absent) set the page date: **`{{date}}`** / **`{{Date}}`** and **`{{PublishDate}}`** / **`{{publishdate}}`** show the same **formatted** date when the value looks like `YYYY-MM-DD` (locale long form, e.g. April 4, 2026). Use **`{{dateIso}}`** for the raw string. The **`{{byline}}`** line uses **author • formatted date** when a date is set, otherwise **author • calendar year**. **Create Mental Stack** uses the same formatting for the exported `Date:` line.

Example:

```text
# CHAPTER_START_INDEX=0
book/index.html # pub=2026-04-01
book/chapter-01.html # pub=2026-04-04, something_else=draft
book/chapter-02.html
```

---

## Project layout (typical)

```text
.
├── articles/              # Source HTML (never overwritten by the builder)
│   └── book/
│       ├── index.html     # Landing template (first line of your .mastack)
│       └── chapter-01.html
├── stacks/
│   └── book.mastack       # Ordered list of article paths
├── templates/
│   ├── base.html          # Chapter page wrapper (from init or your own)
│   └── base.css           # Styles copied next to output module (e.g. dist/book/base.css)
├── defaults.json          # Optional workspace root settings
├── dist/                  # Generated site (usually gitignored)
├── pasteboard_test.txt    # Optional scratch file (gitignored if added by init)
└── ...
```

The repo includes an **`example_workspace/`** sample you can open as the workspace root to try **Rebuild** and **Mental Stack** commands.

---

## Development setup

- **macOS / Linux:** run `./setup.sh` from the repo root (or install with `npm install` and create folders by hand).
- **Windows:** run `setup.ps1` or `setup.cmd`.
- Build: `npm run compile` (typecheck, lint, bundle). See **[README_DEV.md](README_DEV.md)** for CI and how it maps to local scripts.

---

## Install locally (without publishing)

Use either approach; both avoid the Marketplace.

### Extension Development Host (good for changing code)

1. Open the **`stack/`** folder in VS Code (**File → Open Folder…**) so the window’s workspace root is this extension (the `.vscode/launch.json` config relies on that).
2. Install dependencies once: `npm install` (or use **Development setup** above).
3. Press **F5**, or **Run and Debug** → **Run Extension**. A **preLaunchTask** runs `npm run compile`, then a new **Extension Development Host** window opens with this build loaded from disk.
4. In that new window, **File → Open Folder…** on your book or sample project (for example **`example_workspace/`** or another folder). Run MorphArray commands there.

After code changes, stop and start the debug session (or re-run **Run Extension**) so the host picks up a fresh compile.

### Install from a `.vsix` (use your normal VS Code window)

1. In a terminal, `cd` to **`stack/`**, then run `npm install` and `npm run package` (production bundle to `dist/extension.js`).

2. Create the `.vsix` on your **Desktop** (or another folder outside the repo) so `stack/` is not littered with artifacts. Stay in **`stack/`** and run **one** of the shell one-liners below. Each runs `vsce package` with `--out` pointed at your Desktop and the filename version taken from `package.json`.

**macOS / Linux** (bash or zsh):

```bash
npx --yes @vscode/vsce package --out ~/Desktop/morpharray-stack-$(node -p "require('./package.json').version").vsix
```

On some Linux desktops the folder isn’t `~/Desktop`; substitute another path after `--out`, or use `"$XDG_DESKTOP_DIR/…"` when that variable is set.

**Windows** (PowerShell):

```powershell
npx --yes @vscode/vsce package --out "$env:USERPROFILE\Desktop\morpharray-stack-$(node -p 'require("./package.json").version').vsix"
```

**Windows** (Git Bash): same one-liner as macOS / Linux. **Git Bash** maps `~/Desktop` onto your Windows user Desktop (e.g. `C:\Users\YourName\Desktop`). **cmd.exe** does not understand `~`. **PowerShell** idiomatically uses `$env:USERPROFILE\Desktop` (see above); recent PowerShell versions often accept `~` in paths too.

```bash
npx --yes @vscode/vsce package --out ~/Desktop/morpharray-stack-$(node -p "require('./package.json').version").vsix
```

**Windows** (Command Prompt): `cmd.exe` has no equivalent to `$(…)` substitution; use **PowerShell** or **Git Bash** and a command above, or run a longer `for /f` loop if you must stay in `cmd`.

3. In VS Code: **Extensions** → **`…`** (Views and More Actions) → **Install from VSIX…** → choose the `.vsix` on your Desktop. Reload if prompted.

To update a VSIX install, bump `version` in `package.json` if needed (VS Code may not reinstall the same version), then repeat steps 1–3.

---

## License

MIT (see repository).
