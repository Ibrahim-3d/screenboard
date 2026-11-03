# screenboard

Every route of your app and every HTML mockup on one pan/zoom canvas, live, with numbered comment pins that your coding agent can read, fix, answer and resolve.

```
npx screenboard init     # detect the app, write screenboard.config.json, install the agent skill
npx screenboard --open   # start the board and open it
```

Zero dependencies, Node 20+, local only (binds to 127.0.0.1).

## What you get

- **App space**: each detected route as a desktop (1440) and phone (390) frame. Frames are the real running dev server, proxied through the board's own port (HTTP and the HMR websocket), so a saved file updates the board like any open tab. "Full length" shows whole pages, with `vh` units pinned to the device height.
- **Mockups space**: static HTML files served straight from disk. A folder adds every `.html` in it; links between mockup pages work.
- **Comments**: press `C`, click anything, type. Pins are anchored to the element (CSS selector + offset), so they follow layout changes. Drag to move, reply, resolve, delete. The list has Open / Resolved / All filters; the open count is always visible.
- Pan (drag the background, or Space + drag), zoom (Ctrl/Cmd + wheel), drag a frame by its label (positions are remembered), Fit, Reset layout, Reload frames, ▶ Play for one frame at full size, and the label link opens the page alone (with pins).

Pins are stored in `.screenboard/comments.json`: pretty-printed UTF-8, one array, easy to diff and commit.

## Commands

| Command | What it does |
|---|---|
| `screenboard init [--dry-run] [--no-skill] [--no-script]` | Detect and write the config, install `.claude/skills/screenboard/SKILL.md`, add a `board` script to package.json. `--dry-run` only prints the detection. |
| `screenboard [dev] [--port N] [--start] [--open]` | Start the board (default port 5191, next free one if busy). `--start` also runs the app's dev command when it is not running. |
| `screenboard add <file.html\|folder>... [--label X] [--width N] [--height N]` | Add mockups. `file.html#screen` frames one hash screen. |
| `screenboard comments [--open\|--resolved] [--json]` | List pins with the frame, the source file, the element (tag, classes, text), the selector and the thread. |
| `screenboard reply <id> ["text"] [--resolve\|--reopen]` | Answer a pin as the agent. |
| `screenboard --check` | Self-test: boots a board against a fake dev server and checks every route. |

## The agent loop

`init` installs a skill that tells Claude Code (or any agent that reads `.claude/skills`) to run `screenboard comments --open`, open each pin's source file, find the element by its text and selector, make the change, then `screenboard reply <id> "what changed" --resolve`.

## How detection works

| Framework | Routes from | Dev port from |
|---|---|---|
| Next.js | `app/` (route groups stripped; `@slot`, `_private`, intercepting skipped) and `pages/` (`_app`, `api/` skipped) | `-p` in the dev script, `.env` `PORT`, `site.config.json`, else 3000 |
| Vite | react-router / vue-router path declarations, `vite-plugin-pages` / generouted `src/pages`, TanStack `src/routes`, extra root `.html` entries; else `/` | `server.port` in `vite.config`, `--port`, else 5173 |
| Astro | `src/pages` (`_` files and endpoints skipped) | `server.port`, else 4321 |
| SvelteKit | `src/routes/**/+page.svelte` | `vite.config`, else 5173 |
| Nuxt | `pages/` or `app/pages/` | `devServer.port`, else 3000 |
| Remix / React Router 7 | flat routes in `app/routes`, or `app/routes.ts` | else 5173 |
| Eleventy | templates under the input dir, `permalink` front matter | `--port=` in the script, else 8080 |
| Plain HTML | every `.html` file, served by the board itself | none needed |

On top of the file routes: concrete paths from a generated route list (`**/generated/*known-paths*`, `*routes*`), `sitemap.xml` (in `public/`, `static/`, the root, or served by the running app), and dynamic routes sampled from a content folder of the same name (`/blog/[slug]` → `content/blog/*`). Mockup folders are found by name (`mockups`, `prototype`, `design`, `wireframes`).

If the configured port is not answering and it was only the framework default, common ports are probed for a server of the same framework (reported as medium confidence: it may be another project). Each result gets a confidence: **high**, **medium** or **manual**.

## Config

`screenboard.config.json` at the repo root; every key is optional.

```json
{
  "title": "my-app",
  "port": 5191,
  "authors": ["human", "agent"],
  "app": {
    "framework": "next",
    "url": "http://localhost:3000",
    "start": "pnpm dev",
    "routes": ["/", "/pricing"],
    "exclude": ["/admin"],
    "devices": [{ "name": "Desktop", "width": 1440, "height": 900 }, { "name": "Phone", "width": 390, "height": 844 }]
  },
  "mockups": [{ "path": "docs/mockups" }, { "path": "design/flow.html#step-2", "label": "Step 2", "width": 390 }],
  "rootSelector": "body",
  "anchorAttrs": ["id", "data-testid"],
  "columns": { "default": 3 }
}
```

`app.routes` replaces detection; without it routes are re-detected each time the board loads, so new pages show up on reload.

## Limits

- Dynamic routes without a generated list, sitemap or matching content folder are skipped (listed as "skipped" by `init`).
- Client-side screens of a single-page app without a router library (state-driven views) cannot be detected: add them to `app.routes`.
- Router paths declared in code are read with a pattern match; nested relative paths are taken as top level (medium confidence).
- Monorepos: run `init` inside the app's folder.
- Mockups must sit inside the repo, and pages that use root-absolute links (`/page.html`) will leave the mockup folder.
- Pages that block framing with JavaScript, or need a login, show what the dev server returns to a fresh tab.
- At most 60 routes are framed; use `exclude` or `routes` for larger sites.
- Pins are matched by CSS path; a big markup change can move a pin to its nearest surviving parent.

## License

MIT
