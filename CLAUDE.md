# screenboard

Every route of an app and every HTML mockup on one pan/zoom canvas, live, with numbered comment pins that a coding agent can read, fix, answer and resolve. Zero runtime dependencies, Node 20+, ESM, local only (127.0.0.1). Working name `screenboard`; it is not final and not published.

README.md is the public user doc. This file is for agents working in this repo.

## Commands
| Purpose | Command |
|---|---|
| Tests (23, node:test) | `npm test` |
| Self-test (boots a board against a fake dev server, 30 checks incl. snapshots) | `npm run check` |
| Start a board | `node bin/screenboard.mjs [dev] [--port N] [--start] [--open]` |
| Try detection without writing | `node bin/screenboard.mjs init --dry-run` (run it inside an app folder) |
| Shoot every frame (JPG + manifest in `.screenboard/renders/`) | `node bin/screenboard.mjs render [match...] [--viewport]` |
| Pins for an agent | `node bin/screenboard.mjs comments --open [--json]`, `reply <id> "text" [--resolve]`, `shot <code|id>` |

Run commands from this folder. Default board port is 5191 (next free one if busy). 5190 belongs to the FabLab prototype, 5180 to the FabLab app.

## Layout
- `bin/screenboard.mjs`: CLI entry (init, dev, add, comments, reply, --check).
- `src/detect.mjs`: framework, dev port and route detection. `src/server.mjs`: board server with a same-origin proxy (HTTP plus the HMR websocket). `src/store.mjs`: pin store. `src/config.mjs`, `src/check.mjs`.
- `src/render.mjs`: headless Chrome/Edge over the DevTools protocol (Node's built-in WebSocket), parallel tabs, each opening the board in solo mode (`?solo=<frame id>`); also the store-only zip for Export all. Used by the `render` command and `POST /api/render` (the Export buttons).
- `src/name.mjs`: the tool name comes from `package.json` only; every file name, folder, URL prefix and command derives from it. Renaming = change `package.json` `name` (and the skill is templated with `{{NAME}}`).
- `ui/board.html`, `ui/comments.js`: the canvas and the comment layer (served to the browser, injected into frames).
- `skill/SKILL.md`: the agent skill that `init` installs into a target repo's `.claude/skills/`.
- `fixtures/`: tiny projects, one per supported framework; `test/` uses them.

## Data contract
Target repos get `screenboard.config.json` (written by `init`) and `.screenboard/comments.json` (pretty-printed UTF-8, one array). Pin fields: id, screen, frame, selector, x, y, text, author (`founder` | `claude`), status (`open` | `resolved`), createdAt, thread[]. A pin is anchored by frame plus CSS selector plus x/y percentage inside the element. Box pins add `shot: { code SB-####, file, ctxFile, box { frame, selector, x, y, w, h %, px, dpr, viewport }, method display-capture|dom }`; the PNGs live in `.screenboard/shots/`, only the server writes them (it picks code and file names; clients cannot set `shot`), and deleting the pin deletes them. Old pins without `shot` stay valid. Keep the file human-diffable.

## Rules for this repo
- Zero runtime dependencies. Do not add one. Dev tooling is `node --test` only.
- Do not publish (no `npm publish`, no GitHub repo creation, no push) without the owner's explicit word. Everything so far is local commits.
- Detection must be honest: report confidence (high / medium / manual needed) and what was skipped. Never claim a framework works without a fixture and a test.
- UI text: cut taglines, helper text and secondary labels. If a screen needs them to make sense, fix the layout.
- Keep shortcuts layout-proof: use `e.code` (physical key), not `e.key`. The owner types on an Arabic layout; a frame must not steal keyboard focus while the mouse is elsewhere.
- Write text files as UTF-8, LF line endings (`.gitattributes` forces it; the bin has a shebang).
- Commit after each coherent step. Trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Dev servers that are already running stay running. Check a port before starting anything.
- Verify UI changes in a real browser. If you use a shared Playwright browser, another session may navigate it: for a reliable check run an isolated headless Chromium (playwright-core with an installed chromium) and read real state (`#cm-chip[aria-pressed]`, `#cm-side[hidden]`), not the `cm-on` class (that is set inside frames).

## Where it came from
Built 2026-11-03 in the FabLab project (`E:\active_AI_WORKSPACE\PROJECTS\Fablab`, branch `development`) while polishing the editor mockup v2. The owner wanted a Figma-style space to click through a mockup and leave pinned comments an agent can read. Search found no fitting npm tool (Agentation, Impeccable live mode and Penpot were judged worse fits). It was adapted from the owner's own hand-written v3 board (`E:\active_AI_WORKSPACE\PROJECTS\presonal website\tooling\board`, a pan/zoom canvas of live iframes with no comments) and first lived as `Fablab/docs/design/prototype/tool/`. This repo is the extraction. The goal: install in any repo with one command like the owner's `graphify` tool, detect the main site's UI and routes, and also host plain HTML mockups.

## State
Published: screenboard@0.1.0 on npm (2026-11-03), repo github.com/Ibrahim-3d/screenboard, site ibrahim-3d.github.io/screenboard.
Done and tested: init/dev/add/comments/reply/--check, detection for Next (app and pages), Vite with and without react-router, Astro, SvelteKit, Nuxt, Remix, Eleventy, plain HTML, mockups-only repos; canvas with pan/zoom/drag/Fit/Reset/Reload; ▶ Preview (full size, arrow keys step through frames); C pins (drag, reply, resolve, delete, filtered list, open count); layout-proof C key; box snapshots (drag a box in comment mode: tab capture with one prompt per session, DOM fallback), verified in isolated headless Chromium on WebGL, 2D canvas and DOM content, at board zoom 25% and in Preview 1:1.
Real runs: the FabLab app (Vite, port 5180, medium confidence because no router, only `/`), the FabLab mockups (4 files), the v3 portfolio (`ibrahim3d-v3`, Next, port 3550, 31 routes, high confidence; its dev server was not running so frames showed the start command).
Render/Export (2026-11-04): `render` command, per-frame Export and Export all buttons, JPG q80 (about half a PNG). Real runs: demo 6 frames 3.6 s, FabLab mockups 12 frames 8.6 s (WebGL captured), Corallo POS on live Vite 2 frames 1.7 s. Needs Node 22+ (WebSocket, zlib.crc32); the rest still runs on 20. The sveltekit detection test fails when something is listening on 5173 (environmental).
Known limits: see README "Limits" (dynamic routes without a list, router-less SPAs, monorepo roots, 60-route cap, root-absolute links in mockups, pins drifting after big markup changes).

## Open items
1. Next: switch FabLab prototype to this package (item 2); decide .screenboard/ ignore policy (item 4).
2. Switch FabLab's prototype (`Fablab/docs/design/prototype`, port 5190) from its own older copy of the tool to this package (owner said "switch fablab" is his call).
3. Skill is Claude Code only; other agents' skill folders are skipped.
4. No `.gitignore` line is added to target repos by `init`; decide whether `.screenboard/` should be ignored or committed.

## Owner working style
ADHD: answer first, short numbered steps, one next action, state restated each turn. He does not read docs; decisions reach him in chat as short tables or one-click questions. Ask only what he alone can answer (name, money, legal, taste); decide and state the rest. Open visual results in his browser. Never claim something works without running it, and report what was not checked.
