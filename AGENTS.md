# Superdesign MCP + design workflow

Use this when the **superdesign** MCP server is enabled (Codex, Claude Code, Cursor, etc.).

## Tools

| Tool | Purpose |
|------|---------|
| `open_canvas` | Start local canvas server, open browser. Pass **absolute** `workspacePath` (project root). |
| `save_design` | Write HTML/SVG to `.superdesign/design_iterations/<fileName>`. Optional `workspacePath` if not inferable from session. |
| `load_designs` | Push latest files from disk to connected browser clients. |
| `wait_for_canvas_action` | **Block** until the user triggers feedback from the canvas (e.g. iterate / copy prompt actions). Returns JSON: `fileName`, `filePath`, `prompt`, `fileContent`. |

## Recommended loop

1. Call `open_canvas` with the repo root. Read `instructions` in the tool result.
2. Implement or revise designs with `save_design` (self-contained HTML/SVG; prefer inline CSS for portability).
3. Call `load_designs` so the canvas refreshes.
4. Call `wait_for_canvas_action` and wait for the user.
5. Use the returned `prompt` and `fileContent` as the next task; save a new file (e.g. `hero_1_v2.html` or `hero_1_1.html` for branches).
6. Repeat from step 3.

## Naming (aligns with Superdesign canvas hierarchy)

- New concept: `name_1.html`, `name_2.html`.
- Iteration on one line: `name_1_v2.html`, `name_1_v3.html`.
- Branch variants: `name_1_1.html`, `name_1_2.html`.

## MCP config example

```json
{
  "mcpServers": {
    "superdesign": {
      "command": "npx",
      "args": ["-y", "superdesign-mcp"]
    }
  }
}
```

For local monorepo development, point `command` to `node` and `args` to `packages/mcp-server/dist/server.js` from this repo, run after `npm run build:mcp`.
