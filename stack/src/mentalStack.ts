import * as vscode from 'vscode';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';
import type { ArticleSectionFormatOptions } from './types.js';
import {
	articleUriFromRelative,
	decodeBuffer,
	formatFrontmatterValue,
	getWorkspaceRoot,
	listStackDefinitionFiles,
	parseArticleMatter,
	parseStackDefinitionLines,
} from './utils.js';

/**
 * Renders metadata (title, date, summary) and full body content for one article (plain layout).
 * Used by summary-style stacks or when emitting non-Markdown sections.
 */
export function formatArticleSection(options: ArticleSectionFormatOptions): string {
	const { index, total, relativePath, title, date, summary, body } = options;
	const lines: string[] = [];
	lines.push('');
	lines.push('='.repeat(80));
	lines.push(`ARTICLE ${index} of ${total}  |  ${relativePath}`);
	lines.push('='.repeat(80));
	lines.push('');
	lines.push(`Title: ${title || '(not set)'}`);
	lines.push(`Date: ${date || '(not set)'}`);
	lines.push(`Summary: ${summary || '(not set)'}`);
	lines.push('');
	lines.push('-'.repeat(80));
	lines.push('CONTENT');
	lines.push('-'.repeat(80));
	lines.push('');
	lines.push(body.trim().length > 0 ? body.trim() : '(empty body)');
	return lines.join('\n');
}

function createTurndownForStacks(): TurndownService {
	const turndownService = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '_',
		strongDelimiter: '**',
	});
	turndownService.use(turndownPluginGfm.gfm);
	return turndownService;
}

/**
 * Creates a Markdown Mental Stack from a `.mastack` definition and copies it to the clipboard.
 */
export async function createMentalStackFullContext(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		void vscode.window.showErrorMessage('MorphArray: Open a folder in VS Code to use Mental Stacks.');
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
			'MorphArray: No `.mastack` files found in `stacks/`. Add a stack definition file (e.g. stacks/my-stack.mastack).',
		);
		return;
	}

	const quickPickItems: vscode.QuickPickItem[] = stackFileNames.map((name) => ({
		label: name,
		description: path.join('stacks', name),
	}));

	const picked = await vscode.window.showQuickPick(quickPickItems, {
		placeHolder: 'Select a Mental Stack (.mastack)',
		title: 'MorphArray: Create Mental Stack (Full Context)',
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

	const relativePaths = parseStackDefinitionLines(decodeBuffer(stackFileRaw));

	if (relativePaths.length === 0) {
		void vscode.window.showErrorMessage(`MorphArray: Stack file "${selectedName}" has no article paths.`);
		return;
	}

	const turndownService = createTurndownForStacks();

	let output = `MORPHARRAY MENTAL STACK (FULL CONTEXT)\n\n`;
	output += `Stack file: stacks/${selectedName}\n`;
	output += `Workspace: ${vscode.workspace.workspaceFolders?.[0]?.name || 'Untitled'}\n`;
	output += `Generated: ${new Date().toISOString()}\n`;
	output += `Articles: ${relativePaths.length}\n\n`;
	output += `${'='.repeat(80)}\n\n`;

	for (let i = 0; i < relativePaths.length; i++) {
		const relativePath = relativePaths[i].trim();
		const articleUri = articleUriFromRelative(workspaceRoot, relativePath);

		let fileBytes: Uint8Array;
		try {
			fileBytes = await vscode.workspace.fs.readFile(articleUri);
		} catch {
			output += `ERROR: Could not read "${relativePath}"\n\n`;
			continue;
		}

		const fileText = decodeBuffer(fileBytes);
		let parsed: { data: Record<string, unknown>; content: string };

		try {
			parsed = parseArticleMatter(fileText);
		} catch {
			output += `ERROR: Failed to parse frontmatter in "${relativePath}"\n\n`;
			continue;
		}

		const title = formatFrontmatterValue(parsed.data['title']) || relativePath;
		const date = formatFrontmatterValue(parsed.data['date']) || '';
		const summary = formatFrontmatterValue(parsed.data['summary']) || '';

		const $ = cheerio.load(parsed.content);
		$('style, script').remove();
		$('*').removeAttr('style');

		const cleanHtml = $.html();
		const markdownContent = turndownService.turndown(cleanHtml);

		output += `ARTICLE ${i + 1} of ${relativePaths.length} | ${relativePath}\n`;
		output += `Title: ${title}\n`;
		output += `Date: ${date}\n`;
		output += `Summary: ${summary}\n\n`;
		output += `${markdownContent.trim()}\n\n`;
		output += `${'-'.repeat(80)}\n\n`;
	}

	try {
		await vscode.env.clipboard.writeText(output.trim());
		void vscode.window.showInformationMessage(`Mental Stack (${selectedName}) copied to clipboard!`);
	} catch {
		void vscode.window.showErrorMessage('MorphArray: Could not copy to the clipboard.');
	}
}
