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
} from './canvas-server.js';

const WORKFLOW_INSTRUCTIONS = `Superdesign MCP canvas workflow:
1) save_design(fileName, content) writes to .superdesign/design_iterations/ under the workspace (use names like design_1.html; iterations design_1_v2.html or design_1_1.html per your AGENTS.md).
2) load_designs() pushes the latest files to any open browser canvas.
3) wait_for_canvas_action() blocks until the user triggers an action from the canvas (e.g. iterate with feedback). Response JSON: fileName, filePath, prompt, fileContent.
4) Treat the returned prompt as the next instruction; save a new file and repeat.`;

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
