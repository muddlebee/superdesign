import fs from 'node:fs/promises';
import path from 'node:path';

export interface DesignFile {
	name: string;
	path: string;
	relativePath: string;
	content: string;
	size: number;
	modified: Date;
	fileType: 'html' | 'svg';
}

async function inlineExternalCSS(htmlContent: string, designFolder: string): Promise<string> {
	const linkRegex =
		/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
	let modifiedContent = htmlContent;
	const matches = Array.from(htmlContent.matchAll(linkRegex));

	for (const match of matches) {
		const fullLinkTag = match[0];
		const cssFileName = match[1];
		try {
			if (!cssFileName.startsWith('http') && !cssFileName.startsWith('//')) {
				const cssFilePath = path.join(designFolder, cssFileName);
				try {
					const cssText = await fs.readFile(cssFilePath, 'utf8');
					const styleTag = `<style>\n${cssText}\n</style>`;
					modifiedContent = modifiedContent.replace(fullLinkTag, styleTag);
				} catch {
					// keep link tag
				}
			}
		} catch {
			// ignore
		}
	}
	return modifiedContent;
}

export async function loadDesignFilesFromDisk(workspaceRoot: string): Promise<DesignFile[]> {
	const designFolder = path.join(workspaceRoot, '.superdesign', 'design_iterations');
	try {
		await fs.access(designFolder);
	} catch {
		await fs.mkdir(designFolder, { recursive: true });
		return [];
	}

	const entries = await fs.readdir(designFolder, { withFileTypes: true });
	const out: DesignFile[] = [];

	for (const ent of entries) {
		if (!ent.isFile()) {
			continue;
		}
		const name = ent.name;
		const lower = name.toLowerCase();
		if (!lower.endsWith('.html') && !lower.endsWith('.svg')) {
			continue;
		}
		const full = path.join(designFolder, name);
		try {
			const stat = await fs.stat(full);
			let content = await fs.readFile(full, 'utf8');
			const fileType: 'html' | 'svg' = lower.endsWith('.svg') ? 'svg' : 'html';
			if (fileType === 'html') {
				content = await inlineExternalCSS(content, designFolder);
			}
			out.push({
				name,
				path: full,
				relativePath: path.join('.superdesign', 'design_iterations', name).replace(/\\/g, '/'),
				content,
				size: stat.size,
				modified: stat.mtime,
				fileType,
			});
		} catch {
			// skip bad file
		}
	}
	return out;
}

export function designIterationsDir(workspaceRoot: string): string {
	return path.join(workspaceRoot, '.superdesign', 'design_iterations');
}
