import type { ExtensionToWebviewMessage, WebviewMessage } from '../types/canvas.types';
import type { ICanvasTransport } from './transport.interface';

export function createWebSocketTransport(port: number): ICanvasTransport {
	const url = `ws://127.0.0.1:${port}/canvas`;
	const ws = new WebSocket(url);
	const handlers = new Set<(message: ExtensionToWebviewMessage) => void>();
	const queue: WebviewMessage[] = [];

	const flushQueue = () => {
		while (ws.readyState === WebSocket.OPEN && queue.length > 0) {
			const msg = queue.shift();
			if (msg) {
				ws.send(JSON.stringify(msg));
			}
		}
	};

	ws.onopen = () => flushQueue();

	ws.onmessage = (ev) => {
		try {
			const data = JSON.parse(ev.data as string) as ExtensionToWebviewMessage;
			if (data && typeof data === 'object' && 'command' in data) {
				handlers.forEach((h) => h(data));
			}
		} catch {
			// ignore parse errors
		}
	};

	return {
		send(message: WebviewMessage) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(message));
			} else {
				queue.push(message);
			}
		},
		subscribe(handler) {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
	};
}
