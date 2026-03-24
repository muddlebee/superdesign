import type { ExtensionToWebviewMessage, WebviewMessage } from '../types/canvas.types';

/** Bridges canvas UI to host (VS Code webview API or MCP WebSocket server). */
export interface ICanvasTransport {
	send(message: WebviewMessage): void;
	/** Register for host→canvas messages; return unsubscribe. */
	subscribe(handler: (message: ExtensionToWebviewMessage) => void): () => void;
}
