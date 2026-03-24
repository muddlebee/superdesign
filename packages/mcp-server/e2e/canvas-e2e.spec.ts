import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import {
	startCanvasSession,
	stopCanvasSession,
	saveDesignFile,
} from '../src/canvas-server.js';
import { enqueueCanvasActionWaiter } from '../src/canvas-session.js';
import {
	CAFE_MENU_V1,
	CAFE_MENU_V2,
	CAFE_BRANCH_ALT,
	CAFE_NEW_LINE,
	BADGE_SVG,
} from './fixtures/generated-designs.ts';

test.describe.configure({ mode: 'serial' });

function designFrameByFile(page: Page, fileLabel: string) {
	return page.locator('.design-frame').filter({
		has: page.locator('.frame-title', { hasText: fileLabel }),
	});
}

async function iframeInDesignFrame(page: Page, fileLabel: string) {
	const frame = designFrameByFile(page, fileLabel).locator('iframe').first();
	await expect(frame).toBeVisible({ timeout: 45_000 });
	const handle = await frame.elementHandle();
	const fr = await handle?.contentFrame();
	expect(fr, `iframe document for ${fileLabel}`).toBeTruthy();
	return fr!;
}

let populatedWorkspace: string;
let canvasUrl: string;
let httpPort: number;

test.describe('MCP canvas — generated designs & features', () => {
	test.beforeAll(async () => {
		populatedWorkspace = await mkdtemp(path.join(tmpdir(), 'superdesign-mcp-e2e-'));
		const session = await startCanvasSession(populatedWorkspace);
		canvasUrl = session.url;
		httpPort = session.httpPort;

		// Simulate agent-generated iterations: root, version line, branch, SVG asset
		await saveDesignFile(populatedWorkspace, 'cafeteria_1.html', CAFE_MENU_V1);
		await saveDesignFile(populatedWorkspace, 'cafeteria_1_v2.html', CAFE_MENU_V2);
		await saveDesignFile(populatedWorkspace, 'cafeteria_1_2.html', CAFE_BRANCH_ALT);
		await saveDesignFile(populatedWorkspace, 'badge_1.svg', BADGE_SVG);
	});

	test.afterAll(async () => {
		await stopCanvasSession();
		await rm(populatedWorkspace, { recursive: true, force: true });
	});

	test('serves bundle and static assets', async ({ request }) => {
		const bundle = await request.get(new URL('canvas-standalone.js', canvasUrl).href);
		expect(bundle.ok(), await bundle.text()).toBeTruthy();
		expect((await bundle.text()).length).toBeGreaterThan(1000);

		const logo = await request.get(new URL('assets/cursor_logo.png', canvasUrl).href);
		expect(logo.ok()).toBeTruthy();
		expect((await logo.body()).length).toBeGreaterThan(100);
	});

	test('grid shows all generated files as frames', async ({ page }) => {
		await page.goto(canvasUrl);
		await page.waitForLoadState('domcontentloaded');
		await expect(page.locator('.design-frame')).toHaveCount(4, { timeout: 45_000 });
	});

	test('HTML iterations render correct content in iframes', async ({ page }) => {
		await page.goto(canvasUrl);
		const v1 = await iframeInDesignFrame(page, 'cafeteria_1.html');
		await expect(v1.locator('[data-testid="e2e-design-title"]')).toHaveText(/Night Owl Café/);
		await expect(v1.locator('.e2e-sub')).toContainText(/v1/);

		const v2 = await iframeInDesignFrame(page, 'cafeteria_1_v2.html');
		await expect(v2.locator('[data-testid="e2e-design-title"]')).toHaveText(/Night Owl Café/);
		await expect(v2.locator('.e2e-sub')).toContainText(/v2/);

		const branch = await iframeInDesignFrame(page, 'cafeteria_1_2.html');
		await expect(branch.locator('[data-testid="e2e-design-title"]')).toHaveText(/Branch menu/);
	});

	test('SVG design renders', async ({ page }) => {
		await page.goto(canvasUrl);
		const fr = await iframeInDesignFrame(page, 'badge_1.svg');
		await expect(fr.locator('svg')).toBeVisible();
		await expect(fr.locator('text=E2E')).toBeVisible();
	});

	test('screenshots: primary generated design + full canvas', async ({ page }, testInfo) => {
		await page.goto(canvasUrl);
		await expect(page.locator('.design-frame')).toHaveCount(4, { timeout: 45_000 });
		const primary = designFrameByFile(page, 'cafeteria_1.html');
		await expect(primary).toBeVisible();
		await primary.screenshot({ path: testInfo.outputPath('01-generated-cafe-v1-frame.png') });
		await page.screenshot({
			path: testInfo.outputPath('02-canvas-grid-all-frames.png'),
			fullPage: true,
		});
	});

	test('hierarchy layout and connection toggle', async ({ page }, testInfo) => {
		await page.goto(canvasUrl);
		await expect(page.locator('.design-frame')).toHaveCount(4, { timeout: 45_000 });
		await page.locator('[title="Hierarchy Layout"]').click();
		await page.locator('[title="Toggle Connection Lines"]').click();
		await page.waitForTimeout(400);
		await page.screenshot({
			path: testInfo.outputPath('03-hierarchy-with-connections.png'),
			fullPage: true,
		});
	});

	test('global desktop viewport', async ({ page }, testInfo) => {
		await page.goto(canvasUrl);
		await expect(page.locator('.design-frame')).toHaveCount(4, { timeout: 45_000 });
		await page.locator('[title="Toggle Global Viewport Mode"]').click();
		await page.locator('[title="Desktop View (1200×800)"]').click();
		await page.waitForTimeout(400);
		await designFrameByFile(page, 'cafeteria_1.html').screenshot({
			path: testInfo.outputPath('04-desktop-viewport-cafe-v1.png'),
		});
	});

	test('selecting a frame applies selected state', async ({ page }) => {
		await page.goto(canvasUrl);
		await expect(page.locator('.design-frame')).toHaveCount(4, { timeout: 45_000 });
		const target = designFrameByFile(page, 'cafeteria_1_v2.html');
		await target.click({ position: { x: 30, y: 40 } });
		await expect(target).toHaveClass(/selected/);
	});

	test('hot reload: new design file appears after save on disk', async ({ page }) => {
		await page.goto(canvasUrl);
		await expect(page.locator('.design-frame')).toHaveCount(4, { timeout: 45_000 });
		await saveDesignFile(populatedWorkspace, 'cafeteria_2.html', CAFE_NEW_LINE);
		await expect(page.locator('.design-frame')).toHaveCount(5, { timeout: 20_000 });
		const fr = await iframeInDesignFrame(page, 'cafeteria_2.html');
		await expect(fr.locator('[data-testid="e2e-design-title"]')).toHaveText(/Second concept/);
	});

	test('WebSocket iterateInIDEChat resolves wait_for_canvas_action waiter', async () => {
		const done = enqueueCanvasActionWaiter();
		const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/canvas`);
		await new Promise<void>((resolve, reject) => {
			ws.once('open', () => resolve());
			ws.once('error', reject);
		});
		ws.send(
			JSON.stringify({
				command: 'iterateInIDEChat',
				data: {
					fileName: 'cafeteria_1.html',
					filePath: '.superdesign/design_iterations/cafeteria_1.html',
					prompt: 'E2E WS prompt',
				},
			}),
		);
		const raw = await Promise.race([
			done,
			new Promise<string>((_, rej) =>
				setTimeout(() => rej(new Error('timeout waiting for waiter')), 15_000),
			),
		]);
		ws.close();
		const payload = JSON.parse(raw) as { prompt?: string; fileContent?: string; fileName?: string };
		expect(payload.prompt).toBe('E2E WS prompt');
		expect(payload.fileName).toBe('cafeteria_1.html');
		expect(payload.fileContent).toContain('Night Owl Café');
	});

	test('UI: Iterate with feedback resolves same waiter queue', async ({ page }) => {
		await page.goto(canvasUrl);
		await expect(page.locator('.design-frame')).toHaveCount(5, { timeout: 45_000 });

		const done = enqueueCanvasActionWaiter();
		const target = designFrameByFile(page, 'cafeteria_2.html');
		await target.click({ position: { x: 40, y: 45 } });
		await page.getByRole('button', { name: 'Iterate with feedback' }).click();

		const raw = await Promise.race([
			done,
			new Promise<string>((_, rej) =>
				setTimeout(() => rej(new Error('timeout UI iterate waiter')), 15_000),
			),
		]);
		const payload = JSON.parse(raw) as { prompt?: string; fileName?: string; fileContent?: string };
		expect(payload.fileName).toBe('cafeteria_2.html');
		expect(payload.prompt).toContain('variations with this feedback');
		expect(payload.fileContent).toContain('Second concept');
	});
});

let emptyWorkspace: string;
let emptyCanvasUrl: string;

test.describe('MCP canvas — empty workspace', () => {
	test.beforeAll(async () => {
		emptyWorkspace = await mkdtemp(path.join(tmpdir(), 'superdesign-mcp-e2e-empty-'));
		const { url } = await startCanvasSession(emptyWorkspace);
		emptyCanvasUrl = url;
	});

	test.afterAll(async () => {
		await stopCanvasSession();
		await rm(emptyWorkspace, { recursive: true, force: true });
	});

	test('empty state onboarding UI', async ({ page }, testInfo) => {
		await page.goto(emptyCanvasUrl);
		await expect(page.locator('.canvas-empty')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByRole('heading', { name: /No designs found/ })).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath('05-empty-workspace.png'), fullPage: true });
	});
});
