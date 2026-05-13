import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createTurndownForStacks } from './mentalStack.js';
import {
	articleUriFromRelative,
	decodeBuffer,
	formatFrontmatterValue,
	formatStackDateForDisplay,
	getWorkspaceRoot,
	listStackDefinitionFiles,
	parseArticleMatter,
	parseMentalStackDefinition,
	prepareArticleHtmlFragmentForTurndown,
} from './utils.js';

const EXPORT_ROOT = path.join('/tmp', 'mabook');

function articleRelativePathToStem(relativePath: string): string {
	const norm = relativePath.replace(/\\/g, '/').trim();
	let base = norm.replace(/\.(html?)$/i, '');
	base = base.replace(/\//g, '_');
	base = base
		.replace(/[^a-zA-Z0-9_-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
	return base.length > 0 ? base : 'chapter';
}

function allocateFileName(stem: string, used: Map<string, number>): string {
	const key = stem.toLowerCase();
	const n = (used.get(key) ?? 0) + 1;
	used.set(key, n);
	return n === 1 ? stem : `${stem}_${n}`;
}

function timestampDirName(): string {
	const d = new Date();
	const pad = (x: number, w = 2) => String(x).padStart(w, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(
		d.getMinutes(),
	)}-${pad(d.getSeconds())}_${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Writes one Markdown file per **chapter** (every HTML article in the stack after the index line).
 * Output: `/tmp/mabook/<timestamp>/NNN_stem.md` (NNN = 001, 002, …).
 */
export async function exportMarkdownBook(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		void vscode.window.showErrorMessage('MorphArray: Open a folder in VS Code to export Markdown.');
		return;
	}

	const stacksDir = vscode.Uri.joinPath(workspaceRoot, 'stacks');
	let stackFileNames: string[];

	try {
		stackFileNames = await listStackDefinitionFiles(stacksDir);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		void vscode.window.showErrorMessage(`MorphArray: ${msg}`);
		return;
	}

	if (stackFileNames.length === 0) {
		void vscode.window.showErrorMessage(
			'MorphArray: No `.mastack` files found in `stacks/`. Add a stack definition file (e.g. stacks/book.mastack).',
		);
		return;
	}

	const quickPickItems: vscode.QuickPickItem[] = stackFileNames.map((name) => ({
		label: name,
		description: path.join('stacks', name),
	}));

	const picked = await vscode.window.showQuickPick(quickPickItems, {
		placeHolder: 'Select a stack (.mastack) to export chapters as Markdown',
		title: 'MorphArray: Markdown Export',
	});

	if (!picked) {
		return;
	}

	const selectedName = picked.label;
	const stackFileUri = vscode.Uri.joinPath(stacksDir, selectedName);

	let stackFileRaw: Uint8Array;
	try {
		stackFileRaw = await vscode.workspace.fs.readFile(stackFileUri);
	} catch {
		void vscode.window.showErrorMessage(`MorphArray: Could not read stack file "${selectedName}".`);
		return;
	}

	const { segments } = parseMentalStackDefinition(decodeBuffer(stackFileRaw));

	const articleSegments = segments.filter((s) => s.type === 'article');
	if (articleSegments.length <= 1) {
		void vscode.window.showInformationMessage(
			'MorphArray: No chapters to export (stack needs at least one line after the index article).',
		);
		return;
	}

	const outDir = path.join(EXPORT_ROOT, timestampDirName());
	try {
		await fs.mkdir(outDir, { recursive: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		void vscode.window.showErrorMessage(`MorphArray: Could not create export folder: ${msg}`);
		return;
	}

	const turndownService = createTurndownForStacks();
	const usedStems = new Map<string, number>();
	let chapterIndex = 0;
	let wrote = 0;
	let errors = 0;

	for (const seg of segments) {
		if (seg.type !== 'article') {
			continue;
		}
		if (chapterIndex === 0) {
			chapterIndex += 1;
			continue;
		}

		const relativePath = seg.entry.path.trim();
		const stackAttrs = seg.entry.attributes;
		const articleUri = articleUriFromRelative(workspaceRoot, relativePath);

		let fileBytes: Uint8Array;
		try {
			fileBytes = await vscode.workspace.fs.readFile(articleUri);
		} catch {
			errors += 1;
			continue;
		}

		const fileText = decodeBuffer(fileBytes);
		let parsed: { data: Record<string, unknown>; content: string };
		try {
			parsed = parseArticleMatter(fileText);
		} catch {
			errors += 1;
			continue;
		}

		const title = formatFrontmatterValue(parsed.data['title']) || relativePath;
		let date = formatFrontmatterValue(parsed.data['date']) || '';
		if (stackAttrs['pub'] !== undefined && stackAttrs['pub'] !== '') {
			date = stackAttrs['pub'];
		} else if (stackAttrs['date']) {
			date = stackAttrs['date'];
		}
		const summary = formatFrontmatterValue(parsed.data['summary']) || '';

		const cleanHtml = prepareArticleHtmlFragmentForTurndown(parsed.content);
		const markdownBody = turndownService.turndown(cleanHtml).trim();

		const num = String(chapterIndex).padStart(3, '0');
		chapterIndex += 1;

		const stem = allocateFileName(articleRelativePathToStem(relativePath), usedStems);
		const fileName = `${num}_${stem}.md`;
		const outPath = path.join(outDir, fileName);

		const metaLines: string[] = ['---'];
		metaLines.push(`title: ${JSON.stringify(title)}`);
		if (date) {
			metaLines.push(`date: ${JSON.stringify(formatStackDateForDisplay(date))}`);
		}
		if (summary) {
			metaLines.push(`summary: ${JSON.stringify(summary)}`);
		}
		metaLines.push(`source: ${JSON.stringify(`articles/${relativePath.replace(/\\/g, '/')}`)}`);
		metaLines.push('---');
		metaLines.push('');
		const bodyBlock = markdownBody.length > 0 ? markdownBody : '_(empty)_';
		const fullMd = `${metaLines.join('\n')}\n${bodyBlock}\n`;

		try {
			await fs.writeFile(outPath, fullMd, 'utf8');
			wrote += 1;
		} catch {
			errors += 1;
		}
	}

	const summary =
		errors > 0
			? `MorphArray: Wrote ${wrote} file(s) to ${outDir} (${errors} skipped or failed).`
			: `MorphArray: Wrote ${wrote} chapter file(s) to ${outDir}`;

	void vscode.window.showInformationMessage(summary, 'Open folder').then((choice) => {
		if (choice === 'Open folder') {
			void vscode.env.openExternal(vscode.Uri.file(outDir));
		}
	});
}
