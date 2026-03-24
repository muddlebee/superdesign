import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// CommonJS: Express and its deps use `require()`; ESM bundles hit esbuild's
// "Dynamic require is not supported" shim when Cursor runs with Node.
await esbuild.build({
	entryPoints: [path.join(__dirname, 'src/server.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	outfile: path.join(__dirname, 'dist/server.cjs'),
	banner: { js: '#!/usr/bin/env node\n' },
	// `open` resolves __dirname via import.meta.url; empty in a CJS bundle → crash at load.
	external: ['open'],
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

console.log('superdesign-mcp build complete (dist/server.cjs + dist/public/)');
