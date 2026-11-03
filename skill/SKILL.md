---
name: {{NAME}}
description: "Use when the user mentions the board, screen or mockup comments, pins, design feedback left on screens, 'check the board', 'fix the comments', or wants every page and mockup of this app on one canvas. Starts the {{NAME}} board, reads the pins left on live routes and HTML mockups, fixes each in source, replies and resolves."
---

# /{{NAME}}

A local canvas of every route of this app (desktop + phone, live through the dev server) and every HTML mockup, with numbered comment pins. Pins live in `{{COMMENTS_FILE}}`; config in `{{CONFIG_FILE}}`.

## Start the board

```
{{RUN}} --open            # board for this repo; prints the URL and opens it
{{RUN}} --start --open    # also starts the app's dev server if it is not running
```

Leave it running. Comment mode is the C key: a click drops a pin, a drag draws a box and saves a snapshot of it (`.screenboard/shots/`).

## Work the comments

1. `{{RUN}} comments --open` (add `--json` for structured output).
2. If a pin has a `shot` (a box the user drew, code like `SB-0001`), look at both PNGs before touching code: `box` is exactly the area meant, `in context` is the whole frame with that area outlined. Read them as images. A `dom snapshot` may show canvases (3D viewports) blank: that is the capture, not the bug.
3. For each pin, open its `source` file. Find the element by `element` (tag, classes, text: grep for the text) and `selector` (CSS path from the page body; for a box, `shot.box` gives the area as % of that element). Make the change.
4. `{{RUN}} reply <id> "what changed" --resolve`, naming the shot code when there is one ("SB-0001: ..."). If the request is unclear, reply with a question and leave it open.
5. Re-check: the board hot-reloads; look at the frame (or a screenshot) before resolving. Repeat until `comments --open` is empty.

## Other commands

- `{{RUN}} shot <code|id>`: absolute paths of a box pin's two PNGs.
- `{{RUN}} add <file.html|folder> [--label "Name"]`: put mockups on the board's Mockups space (a folder adds every .html; `file.html#screen` works for hash screens).
- `{{RUN}} init --dry-run`: show what was detected (framework, dev URL, routes, confidence) without writing.
- Wrong or missing routes: set `app.routes` (a list of paths) or `app.exclude` (path prefixes) in `{{CONFIG_FILE}}`.

## Rules

- Resolve only after the change is made and checked.
- Never delete a pin; resolving keeps the history.
- The comments file is plain JSON: reading it directly is fine, write through `reply`.
