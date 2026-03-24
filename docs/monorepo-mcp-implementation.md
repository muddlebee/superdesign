# Monorepo, shared canvas, and MCP server — implementation notes

This document describes the repository layout and behavior after the Superdesign monorepo and `superdesign-mcp` work. It is aimed at contributors and anyone integrating the MCP server or the shared canvas package.

## High-level goals

- **Single source of truth** for the design canvas UI (`@superdesign/canvas-app`) used by both the VS Code extension and the standalone browser canvas served by the MCP server.
- **CLI-friendly design loop**: Codex, Claude Code, or any MCP-capable client can open a local canvas, save designs to disk, refresh the UI, and block on user actions from the canvas via `wait_for_canvas_action`.
- **VS Code behavior preserved**: The extension still bundles the same React canvas; only the host bridge (transport) changed.

## Repository layout

| Path | Role |
|------|------|
| [`package.json`](../package.json) (root) | Private npm **workspaces** root: `apps/*`, `packages/*`. Scripts: `build`, `build:canvas`, `build:extension`, `build:mcp`, `test:e2e`, watch scripts delegating to the extension workspace. |
| [`apps/vscode-extension/`](../apps/vscode-extension/) | VS Code extension: `package.json` (publisher, `contributes`, `main: dist/extension.js`), `src/`, `esbuild.js`, `tsconfig.json`, `icon.png`, [`.vscodeignore`](../apps/vscode-extension/.vscodeignore). |
| [`packages/canvas-app/`](../packages/canvas-app/) | Shared React canvas: components, types, `transport/`, [`canvas.css`](../packages/canvas-app/src/canvas.css), standalone bundle entry [`standalone.tsx`](../packages/canvas-app/src/standalone.tsx). |
| [`packages/mcp-server/`](../packages/mcp-server/) | Published **`superdesign-mcp`** package: MCP stdio server, local HTTP + WebSocket canvas host, static `dist/public/` (copied at build). |

## Shared canvas package (`@superdesign/canvas-app`)

### Exports (see [`packages/canvas-app/package.json`](../packages/canvas-app/package.json))

- `.` → [`CanvasView`](../packages/canvas-app/src/components/CanvasView.tsx) (default export)
- `./transport` → [`createVscodeTransport`](../packages/canvas-app/src/transport/vscode.transport.ts), [`createWebSocketTransport`](../packages/canvas-app/src/transport/websocket.transport.ts)
- `./icons` → shared [`Icons`](../packages/canvas-app/src/components/Icons.tsx) (used by extension chat UI)
- `./canvas.css` → standalone browser theming (VS Code variable fallbacks)
- `./standalone` → browser-only bootstrap (used by MCP static build)

### Transport abstraction

Canvas code does not call `vscode.postMessage` directly. It uses [`ICanvasTransport`](../packages/canvas-app/src/transport/transport.interface.ts):

- `send(message)` — webview → host (same message shapes as before: `loadDesignFiles`, `iterateInIDEChat`, etc.).
- `subscribe(handler)` — host → webview (`designFilesLoaded`, `fileChanged`, `error`). Returns an unsubscribe function.

Implementations:

- **VS Code**: [`createVscodeTransport()`](../packages/canvas-app/src/transport/vscode.transport.ts) — `acquireVsCodeApi()` + `window.addEventListener('message', …)`.
- **MCP / browser**: [`createWebSocketTransport(port)`](../packages/canvas-app/src/transport/websocket.transport.ts) — connects to `ws://127.0.0.1:<port>/canvas`, JSON payloads, queues `send` until `open`.

Extension wiring: [`apps/vscode-extension/src/webview/App.tsx`](../apps/vscode-extension/src/webview/App.tsx) creates one `createVscodeTransport()` instance and passes it to `<CanvasView transport={…} />`.

### Message types

Canonical types live in [`packages/canvas-app/src/types/canvas.types.ts`](../packages/canvas-app/src/types/canvas.types.ts), including `WebviewMessage`, `ExtensionToWebviewMessage`, and `initializeSuperdesign` on the outbound union where applicable.

## MCP server (`superdesign-mcp`)

### Runtime layout

- **Entry**: [`packages/mcp-server/src/server.ts`](../packages/mcp-server/src/server.ts) — `McpServer` from `@modelcontextprotocol/sdk`, `StdioServerTransport`, tool registration.
- **Canvas host**: [`packages/mcp-server/src/canvas-server.ts`](../packages/mcp-server/src/canvas-server.ts) — Express static server, WebSocket on `/canvas`, `chokidar` on `.superdesign/design_iterations/**/*.{html,svg,css}`, optional `open()` for default browser.
- **Session / waiters**: [`packages/mcp-server/src/canvas-session.ts`](../packages/mcp-server/src/canvas-session.ts) — connected WebSocket clients, FIFO queue for `wait_for_canvas_action`.
- **Disk I/O**: [`packages/mcp-server/src/design-files.ts`](../packages/mcp-server/src/design-files.ts) — load designs, inline linked CSS for HTML (mirrors extension behavior conceptually).

### Resolving static files (`dist/public`)

[`resolveCanvasPublicDir()`](../packages/mcp-server/src/canvas-server.ts) walks upward from the current module file until it finds a directory containing `canvas-standalone.js`. That supports:

- Production: `packages/mcp-server/dist/public/` (after build).
- Tests / `tsx`: imports from `src/` still resolve to `…/mcp-server/dist/public` once the monorepo build has run.

### MCP tools

| Tool | Behavior |
|------|-----------|
| `open_canvas` | `startCanvasSession(workspacePath)` — HTTP + WS + watcher; opens browser; returns JSON with `url` and workflow `instructions`. |
| `load_designs` | Reads workspace `.superdesign/design_iterations/`, broadcasts `designFilesLoaded` to all WS clients. |
| `save_design` | Writes `fileName` under that directory; watcher notifies clients → canvas sends `loadDesignFiles` again (same as extension file watcher flow). |
| `wait_for_canvas_action` | Blocks until a client sends `iterateInIDEChat` over WS; returns JSON `fileName`, `filePath`, `prompt`, `fileContent` (content read from disk server-side). |

Requires an active session and, for `wait_for_canvas_action`, at least one browser tab connected (the canvas page).

### Build ([`packages/mcp-server/esbuild.config.mjs`](../packages/mcp-server/esbuild.config.mjs))

1. Bundles `src/server.ts` → `dist/server.cjs` (CommonJS, shebang for `bin`; avoids Express + ESM `require` shim issues).
2. Copies `packages/canvas-app/dist/canvas-standalone.js` → `dist/public/canvas-standalone.js`.
3. Copies logo assets from `apps/vscode-extension/src/assets/` → `dist/public/assets/`.

## VS Code extension build

- [`apps/vscode-extension/esbuild.js`](../apps/vscode-extension/esbuild.js) — extension + webview bundles; **canvasAppResolvePlugin** resolves `@superdesign/canvas-app`, `@superdesign/canvas-app/transport`, `@superdesign/canvas-app/icons` to `packages/canvas-app/src/...`.
- [`apps/vscode-extension/tsconfig.json`](../apps/vscode-extension/tsconfig.json) — `paths` for the same aliases; `rootDir` removed so TypeScript can follow imports into `packages/canvas-app`.
- Dependency: [`@superdesign/canvas-app": "*"`](../apps/vscode-extension/package.json) (workspace).
- Claude Code SDK copy: if `node_modules` is hoisted to the repo root, the script falls back to `../../node_modules/@anthropic-ai/claude-code`.

## Agent / CLI guidance

- Repo root [`AGENTS.md`](../AGENTS.md) — recommended MCP loop, naming conventions, example MCP config, local dev pointer (`packages/mcp-server/dist/server.cjs` after `npm run build:mcp`).
- `open_canvas` tool result also embeds short **inline instructions** for agents that do not read `AGENTS.md`.

## End-to-end tests (Playwright)

- Location: [`packages/mcp-server/e2e/`](../packages/mcp-server/e2e/).
- Config: [`packages/mcp-server/playwright.config.ts`](../packages/mcp-server/playwright.config.ts) — `workers: 1`, serial mode in spec for shared server state.
- Main spec: [`canvas-e2e.spec.ts`](../packages/mcp-server/e2e/canvas-e2e.spec.ts) — generated HTML/SVG fixtures ([`e2e/fixtures/generated-designs.ts`](../packages/mcp-server/e2e/fixtures/generated-designs.ts)), grid/hierarchy/viewport/hot-reload/WebSocket and UI iterate flows, empty workspace.
- Artifacts: screenshots under `packages/mcp-server/test-results/` (gitignored via [`packages/mcp-server/.gitignore`](../packages/mcp-server/.gitignore)).
- Command: from repo root, `npm run test:e2e` (full `npm run build` then `playwright test` in the MCP workspace).

## CI and publish

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — `npm ci`, Playwright Chromium with system deps, `npm run test:e2e`.
- [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) — `npm run build` (full monorepo), then `vsce` / `ovsx` from `apps/vscode-extension/`.

## Local development quick reference

```bash
npm install          # root: links workspaces
npm run build        # canvas-app → extension → mcp-server
npm run test:e2e     # build + Playwright
```

- **Run extension**: VS Code launch config uses `--extensionDevelopmentPath=${workspaceFolder}/apps/vscode-extension` (see [`.vscode/launch.json`](../.vscode/launch.json)).

## Related files (changelog-style index)

| Area | Files |
|------|--------|
| Root workspace | [`package.json`](../package.json) |
| MCP server source | `packages/mcp-server/src/*.ts`, `esbuild.config.mjs` |
| Canvas shared UI | `packages/canvas-app/src/**` |
| Extension | `apps/vscode-extension/src/**`, `esbuild.js`, `package.json` |
| Docs | `docs/monorepo-mcp-implementation.md` (this file), [`AGENTS.md`](../AGENTS.md) |
