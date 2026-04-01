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
- **Create Mental Stack (Full Context)** — Pick a stack file; the extension loads listed articles, respects YAML frontmatter (with a forgiving fallback when titles contain colons), converts body HTML to **GitHub-flavored Markdown** (incl. tables via Turndown + `turndown-plugin-gfm`), and copies the bundle to the clipboard.
- **HTML-first workflow** — Write normal HTML (and optional frontmatter); the site builder does not modify `articles/`.
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

- **Line 1** — Index / landing page template (e.g. `book/index.html`) with a **`div.chapter-list`** where chapter links are injected.
- **Following lines** — Chapter HTML files, in order (navigation Prev/Next follows this order).

Example:

```text
book/index.html
book/chapter-01.html
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

## License

MIT (see repository).
