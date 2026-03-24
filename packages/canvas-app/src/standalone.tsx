import React from 'react';
import { createRoot } from 'react-dom/client';
import CanvasView from './components/CanvasView';
import { createWebSocketTransport } from './transport/websocket.transport';
import canvasStyles from './canvas.css';

const container = document.getElementById('root');
if (!container) {
	throw new Error('Missing #root');
}

const portAttr = container.getAttribute('data-ws-port');
const port = portAttr ? parseInt(portAttr, 10) : 0;
if (!port || Number.isNaN(port)) {
	throw new Error('Missing or invalid data-ws-port on #root');
}

const styleEl = document.createElement('style');
styleEl.textContent = canvasStyles as string;
document.head.appendChild(styleEl);

const transport = createWebSocketTransport(port);
const root = createRoot(container);
root.render(
	<div className="superdesign-app canvas-view">
		<CanvasView transport={transport} nonce={null} />
	</div>
);
