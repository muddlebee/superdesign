import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	testDir: path.join(__dirname, 'e2e'),
	outputDir: path.join(__dirname, 'test-results'),
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	reporter: 'list',
	use: {
		headless: true,
		ignoreHTTPSErrors: true,
	},
});
