import type { WebSocket } from 'ws';

/** Pending `wait_for_canvas_action` resolvers (FIFO). */
const waiters: Array<(value: string) => void> = [];

export function enqueueCanvasActionWaiter(): Promise<string> {
	return new Promise((resolve) => {
		waiters.push(resolve);
	});
}

export function resolveNextCanvasActionWaiter(payload: object): boolean {
	const resolve = waiters.shift();
	if (!resolve) {
		return false;
	}
	resolve(JSON.stringify(payload));
	return true;
}

export type ClientMessage =
	| { command: 'loadDesignFiles' }
	| { command: 'selectFrame'; data?: { fileName?: string } }
	| { command: 'setContextFromCanvas'; data?: unknown }
	| { command: 'setChatPrompt'; data?: { prompt?: string } }
	| {
			command: 'iterateInIDEChat';
			data?: { fileName?: string; filePath?: string; prompt?: string };
	  }
	| { command: 'initializeSuperdesign' };

const clients = new Set<WebSocket>();

export function registerCanvasClient(ws: WebSocket): void {
	clients.add(ws);
	ws.on('close', () => clients.delete(ws));
}

export function broadcastToCanvasClients(message: object): void {
	const raw = JSON.stringify(message);
	for (const ws of clients) {
		if (ws.readyState === 1) {
			ws.send(raw);
		}
	}
}

export function getConnectedClientCount(): number {
	return clients.size;
}
