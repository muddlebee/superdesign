import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');

await esbuild.build({
	entryPoints: [path.join(__dirname, 'src/standalone.tsx')],
	bundle: true,
	format: 'esm',
	minify: production,
	sourcemap: !production,
	outfile: path.join(__dirname, 'dist/canvas-standalone.js'),
	platform: 'browser',
	logLevel: 'info',
	jsx: 'automatic',
	loader: {
		'.css': 'text',
	},
	define: {
		'process.env.NODE_ENV': production ? '"production"' : '"development"',
	},
});

console.log('canvas-app standalone build complete');
