import chokidar from 'chokidar';
import express from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { WebSocketServer, type WebSocket } from 'ws';
import {
	broadcastToCanvasClients,
	registerCanvasClient,
	resolveNextCanvasActionWaiter,
	type ClientMessage,
} from './canvas-session.js';
import { designIterationsDir, loadDesignFilesFromDisk } from './design-files.js';

/**
 * Directory of this module. CJS bundle from esbuild leaves `import.meta.url` empty; then use argv[1] (the MCP entry).
 */
function moduleDir(): string {
	const u = import.meta.url;
	if (typeof u === 'string' && u.length > 0) {
		return path.dirname(fileURLToPath(u));
	}
	const entry = process.argv[1];
	if (entry) {
		return path.dirname(path.resolve(entry));
	}
	throw new Error('superdesign-mcp: cannot resolve module directory');
}

/**
 * Resolve `dist/public` whether this file runs from `src/` (tsx/tests) or `dist/server.cjs`.
 */
function resolveCanvasPublicDir(): string {
	let dir = moduleDir();
	for (let i = 0; i < 10 && dir !== path.dirname(dir); i++) {
		const candidates = [path.join(dir, 'public'), path.join(dir, 'dist', 'public')];
		for (const pub of candidates) {
			if (fsSync.existsSync(path.join(pub, 'canvas-standalone.js'))) {
				return pub;
			}
		}
		dir = path.dirname(dir);
	}
	throw new Error(
		'superdesign-mcp: missing dist/public/canvas-standalone.js — run npm run build -w @superdesign/canvas-app && npm run build -w superdesign-mcp',
	);
}

export interface CanvasSession {
	workspaceRoot: string;
	httpPort: number;
	publicBaseUrl: string;
	close: () => Promise<void>;
}

let active: CanvasSession | null = null;

export function getActiveSession(): CanvasSession | null {
	return active;
}

export async function stopCanvasSession(): Promise<void> {
	if (!active) {
		return;
	}
	const s = active;
	active = null;
	await s.close();
}

async function handleCanvasClientMessage(
	workspaceRoot: string,
	ws: WebSocket,
	message: ClientMessage,
): Promise<void> {
	switch (message.command) {
		case 'loadDesignFiles': {
			const files = await loadDesignFilesFromDisk(workspaceRoot);
			const serialized = files.map((f) => ({
				...f,
				modified: f.modified.toISOString(),
			}));
			ws.send(JSON.stringify({ command: 'designFilesLoaded', data: { files: serialized } }));
			break;
		}
		case 'iterateInIDEChat': {
			const fileName = message.data?.fileName ?? '';
			const filePath = message.data?.filePath ?? '';
			const prompt = message.data?.prompt ?? '';
			let fileContent = '';
			if (fileName) {
				try {
					const full = path.join(workspaceRoot, '.superdesign', 'design_iterations', fileName);
					fileContent = await fs.readFile(full, 'utf8');
				} catch {
					// ignore
				}
			}
			resolveNextCanvasActionWaiter({ fileName, filePath, prompt, fileContent });
			break;
		}
		case 'initializeSuperdesign': {
			await fs.mkdir(designIterationsDir(workspaceRoot), { recursive: true });
			break;
		}
		default:
			break;
	}
}

/**
 * Start HTTP + WebSocket server and static canvas bundle. Closes any previous session.
 */
export async function startCanvasSession(workspaceRoot: string): Promise<{ httpPort: number; url: string }> {
	await stopCanvasSession();
	const root = path.resolve(workspaceRoot);

	const publicDir = resolveCanvasPublicDir();
	const app = express();
	app.use(express.static(publicDir));

	const httpServer = http.createServer(app);
	const wss = new WebSocketServer({ server: httpServer, path: '/canvas' });

	await new Promise<void>((resolve, reject) => {
		httpServer.listen(0, '127.0.0.1', () => resolve());
		httpServer.on('error', reject);
	});
	const addr = httpServer.address();
	const port = typeof addr === 'object' && addr ? addr.port : 0;
	const baseUrl = `http://127.0.0.1:${port}`;

	app.get('/', (_req, res) => {
		const ctx = JSON.stringify({
			layout: 'panel',
			logoUris: {
				cursor: `${baseUrl}/assets/cursor_logo.png`,
				windsurf: `${baseUrl}/assets/windsurf_logo.png`,
				claudeCode: `${baseUrl}/assets/claude_code_logo.png`,
				lovable: `${baseUrl}/assets/lovable_logo.png`,
				bolt: `${baseUrl}/assets/bolt_logo.jpg`,
			},
		});
		res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Superdesign Canvas</title>
</head>
<body style="margin:0">
  <script>
    window.__WEBVIEW_CONTEXT__ = ${ctx};
  </script>
  <div id="root" data-view="canvas" data-ws-port="${port}"></div>
  <script type="module" src="/canvas-standalone.js"></script>
</body>
</html>`);
	});

	wss.on('connection', (ws) => {
		registerCanvasClient(ws);
		ws.on('message', async (buf) => {
			let msg: ClientMessage;
			try {
				msg = JSON.parse(buf.toString()) as ClientMessage;
			} catch {
				return;
			}
			await handleCanvasClientMessage(root, ws, msg);
		});
	});

	const designDir = designIterationsDir(root);
	await fs.mkdir(designDir, { recursive: true });

	const watcher = chokidar.watch(path.join(designDir, '**/*.{html,svg,css}'), {
		ignoreInitial: true,
	});
	const notify = () => {
		broadcastToCanvasClients({
			command: 'fileChanged',
			data: { fileName: '', changeType: 'modified' },
		});
	};
	watcher.on('all', notify);

	const close = async () => {
		await watcher.close();
		await new Promise<void>((r) => {
			wss.close(() => r());
		});
		await new Promise<void>((r, j) => {
			httpServer.close((err) => (err ? j(err) : r()));
		});
	};

	active = {
		workspaceRoot: root,
		httpPort: port,
		publicBaseUrl: baseUrl,
		close,
	};

	return { httpPort: port, url: `${baseUrl}/` };
}

export async function openCanvasInBrowser(url: string): Promise<void> {
	await open(url);
}

export async function saveDesignFile(
	workspaceRoot: string,
	fileName: string,
	content: string,
): Promise<{ absolutePath: string; relativePath: string }> {
	const root = path.resolve(workspaceRoot);
	const base = path.join(root, '.superdesign', 'design_iterations');
	await fs.mkdir(base, { recursive: true });
	const safeName = path.basename(fileName.replace(/\\/g, '/'));
	if (!safeName || safeName === '.' || safeName === '..') {
		throw new Error('Invalid file name');
	}
	const full = path.join(base, safeName);
	if (!full.startsWith(base)) {
		throw new Error('Invalid path');
	}
	await fs.writeFile(full, content, 'utf8');
	const rel = path.join('.superdesign', 'design_iterations', safeName).replace(/\\/g, '/');
	return { absolutePath: full, relativePath: rel };
}

export async function pushDesignFilesToClients(workspaceRoot: string): Promise<void> {
	const files = await loadDesignFilesFromDisk(workspaceRoot);
	const serialized = files.map((f) => ({
		...f,
		modified: f.modified.toISOString(),
	}));
	broadcastToCanvasClients({ command: 'designFilesLoaded', data: { files: serialized } });
}
