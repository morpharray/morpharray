import * as vscode from 'vscode';
import * as path from 'node:path';
import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';
import type { ArticleSectionFormatOptions } from './types.js';
import {
	articleUriFromRelative,
	decodeBuffer,
	formatChapterOrdinalLabel,
	formatFrontmatterValue,
	formatStackDateForDisplay,
	getWorkspaceRoot,
	listStackDefinitionFiles,
	parseArticleMatter,
	parseStackDefinitionForSiteBuild,
	prepareArticleHtmlFragmentForTurndown,
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
	// `<hr>` → thematic break. Prefer `* * *` over `---`: many tools treat `---` as YAML frontmatter fences
	// and truncate or mis-parse Markdown that follows.
	turndownService.addRule('horizontalRuleMorpharray', {
		filter: ['hr'],
		replacement: () => '\n\n* * *\n\n',
	});
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

	const { entries: stackEntries, chapterStartIndex } = parseStackDefinitionForSiteBuild(
		decodeBuffer(stackFileRaw),
	);

	if (stackEntries.length === 0) {
		void vscode.window.showErrorMessage(`MorphArray: Stack file "${selectedName}" has no article paths.`);
		return;
	}

	const chapterCount = Math.max(0, stackEntries.length - 1);
	const turndownService = createTurndownForStacks();

	let output = `MORPHARRAY MENTAL STACK (FULL CONTEXT)\n\n`;
	output += `Stack file: stacks/${selectedName}\n`;
	output += `Workspace: ${vscode.workspace.workspaceFolders?.[0]?.name || 'Untitled'}\n`;
	output += `Generated: ${new Date().toISOString()}\n`;
	output += `Stack paths: ${stackEntries.length}`;
	if (chapterCount > 0) {
		output += ` (1 index + ${chapterCount} chapter${chapterCount === 1 ? '' : 's'})`;
	}
	output += `\n`;
	output += `CHAPTER_START_INDEX: ${chapterStartIndex} (same as Rebuild Dynamic Story)\n\n`;
	output += `${'='.repeat(80)}\n\n`;

	for (let i = 0; i < stackEntries.length; i++) {
		const relativePath = stackEntries[i].path.trim();
		const stackAttrs = stackEntries[i].attributes;
		const articleUri = articleUriFromRelative(workspaceRoot, relativePath);
		const isIndexLine = i === 0;
		const chapterOrdinal = !isIndexLine && chapterCount > 0 ? i - 1 : null;

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
		let date = formatFrontmatterValue(parsed.data['date']) || '';
		if (stackAttrs['pub'] !== undefined && stackAttrs['pub'] !== '') {
			date = stackAttrs['pub'];
		} else if (stackAttrs['date']) {
			date = stackAttrs['date'];
		}
		const summary = formatFrontmatterValue(parsed.data['summary']) || '';

		const cleanHtml = prepareArticleHtmlFragmentForTurndown(parsed.content);
		const markdownContent = turndownService.turndown(cleanHtml);

		const sectionLabel =
			chapterOrdinal === null
				? `INDEX | ${i + 1} of ${stackEntries.length}`
				: `CHAPTER ${formatChapterOrdinalLabel(chapterStartIndex, chapterOrdinal)} | ${i + 1} of ${
						stackEntries.length
					}`;
		output += `${sectionLabel} | ${relativePath}\n`;
		output += `Title: ${title}\n`;
		output += `Date: ${date ? formatStackDateForDisplay(date) : ''}\n`;
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
