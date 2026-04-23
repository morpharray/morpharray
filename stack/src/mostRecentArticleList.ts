import * as vscode from 'vscode';
import * as cheerio from 'cheerio';
import { getWorkspaceRoot } from './utils.js';
import { TextDecoder } from 'node:util';

const ARTICLE_PUB_LISTS_DIR = 'article-pub-lists';
const MAPUB_EXTENSION = '.mapub';
const OUTPUT_DIR = 'html';
const utf8Decoder = new TextDecoder('utf8');
const MONTH_DAY_YEAR_REGEX =
	/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([1-9]|[12][0-9]|3[01]),\s+(\d{4})\b/;

interface PublishedArticle {
	uri: vscode.Uri;
	relativePath: string;
	title: string;
	dateText: string;
	dateValue: Date;
}

function normalizeRelativePath(value: string): string {
	return value.replace(/\\/g, '/').trim().replace(/^\.?\//, '');
}

function toOutputHtmlFileName(mapubFileName: string): string {
	if (mapubFileName.toLowerCase().endsWith(MAPUB_EXTENSION)) {
		return `${mapubFileName.slice(0, -MAPUB_EXTENSION.length)}.html`;
	}
	return `${mapubFileName}.html`;
}

function extractFolderListFromMapub(content: string): string[] {
	return content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'))
		.map(normalizeRelativePath)
		.filter((line) => line.length > 0);
}

function parseFirstPublishedDate(htmlContent: string): { text: string; value: Date } | undefined {
	const match = htmlContent.match(MONTH_DAY_YEAR_REGEX);
	if (!match) {
		return undefined;
	}
	const parsed = new Date(match[0]);
	if (Number.isNaN(parsed.getTime())) {
		return undefined;
	}
	return { text: match[0], value: parsed };
}

function parseFirstHeadingTitle(htmlContent: string, fallback: string): string {
	const $ = cheerio.load(htmlContent);
	const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
	return heading || fallback;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function renderAnchorListHtml(selectedMapubName: string, items: PublishedArticle[]): string {
	void selectedMapubName;
	const rows = items
		.map((item) => {
			const href = `/${item.relativePath}`;
			const label = `${item.dateText} - ${item.title}`;
			return `  <li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
		})
		.join('\n');

	return rows ? `${rows}\n` : '';
}

export async function createMostRecentArticleList(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		void vscode.window.showErrorMessage(
			'MorphArray: Open a folder first, then run Create Most Recent Article List.',
		);
		return;
	}

	const listsDir = vscode.Uri.joinPath(workspaceRoot, ARTICLE_PUB_LISTS_DIR);
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(listsDir);
	} catch {
		void vscode.window.showErrorMessage(
			'MorphArray: Could not read `article-pub-lists/` in the workspace root.',
		);
		return;
	}

	const files = entries
		.filter(([, type]) => type === vscode.FileType.File)
		.map(([name]) => name)
		.filter((name) => name.toLowerCase().endsWith(MAPUB_EXTENSION))
		.sort((a, b) => a.localeCompare(b));

	if (files.length === 0) {
		void vscode.window.showWarningMessage(
			'MorphArray: No `.mapub` files found in `article-pub-lists/`.',
		);
		return;
	}

	const picked = await vscode.window.showQuickPick(
		files.map((name) => ({
			label: name,
			description: `${ARTICLE_PUB_LISTS_DIR}/${name}`,
		})),
		{
			title: 'MorphArray: Create Most Recent Article List',
			placeHolder: 'Select article publish list file',
		},
	);

	if (!picked) {
		return;
	}

	const selectedPath = `${ARTICLE_PUB_LISTS_DIR}/${picked.label}`;
	console.log(`[MorphArray] Selected article publish list: ${selectedPath}`);
	try {
		let listContent: string;
		try {
			const selectedUri = vscode.Uri.joinPath(listsDir, picked.label);
			const raw = await vscode.workspace.fs.readFile(selectedUri);
			listContent = utf8Decoder.decode(raw);
		} catch {
			void vscode.window.showErrorMessage(
				`MorphArray: Could not read selected file: ${selectedPath}`,
			);
			return;
		}

		const folders = extractFolderListFromMapub(listContent);
		if (folders.length === 0) {
			void vscode.window.showWarningMessage(
				`MorphArray: No folder entries found in ${selectedPath}`,
			);
			return;
		}

		const foundArticles: PublishedArticle[] = [];
		for (const folder of folders) {
			const folderPattern = new vscode.RelativePattern(workspaceRoot, `${folder}/**/*.html`);
			const htmlUris = await vscode.workspace.findFiles(folderPattern);
			for (const htmlUri of htmlUris) {
				if (htmlUri.path.toLowerCase().endsWith('/index.html')) {
					continue;
				}
				try {
					const raw = await vscode.workspace.fs.readFile(htmlUri);
					const content = utf8Decoder.decode(raw);
					const published = parseFirstPublishedDate(content);
					if (!published) {
						continue;
					}
					const relativePath = normalizeRelativePath(vscode.workspace.asRelativePath(htmlUri, false));
					const title = parseFirstHeadingTitle(content, relativePath);
					foundArticles.push({
						uri: htmlUri,
						relativePath,
						title,
						dateText: published.text,
						dateValue: published.value,
					});
				} catch {
					// Skip unreadable files and continue processing.
				}
			}
		}

		foundArticles.sort((a, b) => b.dateValue.getTime() - a.dateValue.getTime());

		const outputDirUri = vscode.Uri.joinPath(listsDir, OUTPUT_DIR);
		await vscode.workspace.fs.createDirectory(outputDirUri);
		const outputName = toOutputHtmlFileName(picked.label);
		const outputUri = vscode.Uri.joinPath(outputDirUri, outputName);
		const outputHtml = renderAnchorListHtml(picked.label, foundArticles);
		await vscode.workspace.fs.writeFile(outputUri, new TextEncoder().encode(outputHtml));

		const outputRel = `${ARTICLE_PUB_LISTS_DIR}/${OUTPUT_DIR}/${outputName}`;
		console.log(`[MorphArray] Generated article list: ${outputRel}`);
		void vscode.window.showInformationMessage(
			`MorphArray: Generated ${OUTPUT_DIR}/${outputName} with ${foundArticles.length} article link(s).`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[MorphArray] Create Most Recent Article List failed:', error);
		void vscode.window.showErrorMessage(
			`MorphArray: Failed to generate article list (${message}).`,
		);
	}
}
