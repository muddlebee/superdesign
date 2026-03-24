import type { ExtensionToWebviewMessage, WebviewMessage } from '../types/canvas.types';
import type { ICanvasTransport } from './transport.interface';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

export function createVscodeTransport(): ICanvasTransport {
	const vscode = acquireVsCodeApi();
	const handlers = new Set<(message: ExtensionToWebviewMessage) => void>();

	const onWindowMessage = (event: MessageEvent) => {
		const data = event.data as ExtensionToWebviewMessage;
		if (data && typeof data === 'object' && 'command' in data) {
			handlers.forEach((h) => h(data));
		}
	};
	window.addEventListener('message', onWindowMessage);

	return {
		send(message: WebviewMessage) {
			vscode.postMessage(message);
		},
		subscribe(handler) {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
	};
}
