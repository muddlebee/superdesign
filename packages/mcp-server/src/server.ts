import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { enqueueCanvasActionWaiter, getConnectedClientCount } from './canvas-session.js';
import {
	getActiveSession,
	openCanvasInBrowser,
	pushDesignFilesToClients,
	saveDesignFile,
	startCanvasSession,
	stopCanvasSession,
} from './canvas-server.js';

const WORKFLOW_INSTRUCTIONS = `Superdesign MCP canvas workflow:
1) save_design(fileName, content) writes to .superdesign/design_iterations/ under the workspace (use names like design_1.html; iterations design_1_v2.html or design_1_1.html per your AGENTS.md).
2) load_designs() pushes the latest files to any open browser canvas.
3) wait_for_canvas_action() blocks until the user triggers an action from the canvas (e.g. iterate with feedback). Response JSON: fileName, filePath, prompt, fileContent.
4) Treat the returned prompt as the next instruction; save a new file and repeat.`;

function printCliHelp(): void {
	console.log(`superdesign-mcp — MCP server on stdio by default (for Cursor, Codex, Claude Code, etc.).

Usage:
  superdesign-mcp
      Start the Model Context Protocol server (JSON-RPC over stdio).

  superdesign-mcp --open-canvas [--no-browser] <workspacePath>
      Same behavior as the open_canvas tool: HTTP + WebSocket canvas for the project.
      Prints one JSON line with url and instructions, then runs until Ctrl+C.
      --no-browser  Do not open a system browser (automation / headless).

With npx, pass arguments after -- so npm does not consume flags:
  npx -y superdesign-mcp -- --open-canvas "$PWD"
`);
}

type OpenCanvasCli = { workspacePath: string; openBrowser: boolean };

function parseOpenCanvasCli(argv: string[]): OpenCanvasCli | 'help' | null {
	const args = argv.slice(2);
	if (args.length === 0) {
		return null;
	}
	if (args[0] === '-h' || args[0] === '--help') {
		return 'help';
	}
	if (args[0] !== '--open-canvas') {
		return null;
	}
	const rest = args.slice(1);
	const openBrowser = !rest.includes('--no-browser');
	const positional = rest.filter((a) => a !== '--no-browser');
	if (positional.length === 0) {
		console.error('error: missing workspacePath after --open-canvas\n');
		printCliHelp();
		process.exit(1);
	}
	const raw = positional[positional.length - 1]!;
	const workspacePath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
	return { workspacePath, openBrowser };
}

async function runOpenCanvasCli(opts: OpenCanvasCli): Promise<void> {
	const { url } = await startCanvasSession(opts.workspacePath);
	if (opts.openBrowser) {
		await openCanvasInBrowser(url);
	}
	console.log(
		JSON.stringify({
			url,
			instructions: WORKFLOW_INSTRUCTIONS,
			hint: 'Canvas server running; Ctrl+C to stop.',
		}),
	);
	const shutdown = async () => {
		await stopCanvasSession();
		process.exit(0);
	};
	process.on('SIGINT', () => void shutdown());
	process.on('SIGTERM', () => void shutdown());
	setInterval(() => {}, 2147483647);
}

function workspaceRootOrError(
	workspacePath: string | undefined,
): { root: string } | { err: string } {
	const session = getActiveSession();
	const root = workspacePath?.trim() || session?.workspaceRoot;
	if (!root) {
		return { err: 'No workspace root. Pass workspacePath or call open_canvas first.' };
	}
	return { root };
}

async function main(): Promise<void> {
	const cli = parseOpenCanvasCli(process.argv);
	if (cli === 'help') {
		printCliHelp();
		return;
	}
	if (cli) {
		await runOpenCanvasCli(cli);
		return;
	}

	const server = new McpServer({
		name: 'superdesign-mcp',
		version: '0.1.0',
	});

	server.registerTool(
		'open_canvas',
		{
			title: 'Open Superdesign canvas',
			description:
				'Starts a local server, opens the design canvas in the browser, and watches .superdesign/design_iterations/.',
			inputSchema: {
				workspacePath: z.string().describe('Absolute path to the project root'),
			},
		},
		async ({ workspacePath }, _extra) => {
			const { url } = await startCanvasSession(workspacePath);
			await openCanvasInBrowser(url);
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ url, instructions: WORKFLOW_INSTRUCTIONS }),
					},
				],
			};
		},
	);

	server.registerTool(
		'load_designs',
		{
			title: 'Load designs into canvas',
			description: 'Reads design files from disk and broadcasts them to connected canvas clients.',
			inputSchema: {
				workspacePath: z
					.string()
					.optional()
					.describe('Project root (optional if open_canvas was used in this session)'),
			},
		},
		async ({ workspacePath }, _extra) => {
			const resolved = workspaceRootOrError(workspacePath);
			if ('err' in resolved) {
				return {
					content: [{ type: 'text' as const, text: resolved.err }],
					isError: true,
				};
			}
			await pushDesignFilesToClients(resolved.root);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
			};
		},
	);

	server.registerTool(
		'save_design',
		{
			title: 'Save design file',
			description: 'Writes HTML or SVG content to .superdesign/design_iterations/<fileName>.',
			inputSchema: {
				workspacePath: z
					.string()
					.optional()
					.describe('Project root (optional if open_canvas was used in this session)'),
				fileName: z.string().describe('File name only, e.g. landing_1.html'),
				content: z.string().describe('Full file contents'),
			},
		},
		async ({ workspacePath, fileName, content }, _extra) => {
			const resolved = workspaceRootOrError(workspacePath);
			if ('err' in resolved) {
				return {
					content: [{ type: 'text' as const, text: resolved.err }],
					isError: true,
				};
			}
			const out = await saveDesignFile(resolved.root, fileName, content);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(out) }],
			};
		},
	);

	server.registerTool(
		'wait_for_canvas_action',
		{
			title: 'Wait for canvas user action',
			description:
				'Blocks until the user triggers iteration/feedback from the canvas UI. Returns JSON with fileName, filePath, prompt, fileContent.',
		},
		async (_extra) => {
			const session = getActiveSession();
			if (!session) {
				return {
					content: [
						{
							type: 'text' as const,
							text: 'No active canvas session. Call open_canvas first.',
						},
					],
					isError: true,
				};
			}
			if (getConnectedClientCount() === 0) {
				return {
					content: [
						{
							type: 'text' as const,
							text: 'No browser is connected. Open the canvas URL returned by open_canvas, then try again.',
						},
					],
					isError: true,
				};
			}
			const raw = await enqueueCanvasActionWaiter();
			return {
				content: [{ type: 'text' as const, text: raw }],
			};
		},
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
