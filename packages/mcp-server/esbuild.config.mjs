import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

await esbuild.build({
	entryPoints: [path.join(__dirname, 'src/server.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile: path.join(__dirname, 'dist/server.js'),
	banner: { js: '#!/usr/bin/env node\n' },
	logLevel: 'info',
});

const publicDir = path.join(__dirname, 'dist/public');
const assetsOut = path.join(publicDir, 'assets');
fs.mkdirSync(assetsOut, { recursive: true });

const canvasBundle = path.join(repoRoot, 'packages/canvas-app/dist/canvas-standalone.js');
if (!fs.existsSync(canvasBundle)) {
	throw new Error(
		`Missing ${canvasBundle}. Run: npm run build -w @superdesign/canvas-app first.`,
	);
}
fs.copyFileSync(canvasBundle, path.join(publicDir, 'canvas-standalone.js'));

const assetsSrc = path.join(repoRoot, 'apps/vscode-extension/src/assets');
if (fs.existsSync(assetsSrc)) {
	for (const f of fs.readdirSync(assetsSrc)) {
		if (/\.(png|jpg|jpeg|svg)$/i.test(f)) {
			fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsOut, f));
		}
	}
}

console.log('superdesign-mcp build complete (dist/server.js + dist/public/)');
