import * as vscode from 'vscode';
import { getWorkspaceRoot } from './utils.js';
import { TextDecoder } from 'node:util';

const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf8');

export const PASTEBOARD_TEST_FILE = 'pasteboard_test.txt';

/** Single book folder under `articles/` — paths in `stacks/book.mastack` match this. */
export const DEFAULT_BOOK_SLUG = 'book';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

function pathSegments(relativePath: string): string[] {
	return relativePath.split('/').filter((s) => s.length > 0);
}

async function mkdirParentsForFile(workspaceRoot: vscode.Uri, relativePath: string): Promise<void> {
	const segments = pathSegments(relativePath);
	if (segments.length <= 1) {
		return;
	}
	let current = workspaceRoot;
	for (let i = 0; i < segments.length - 1; i++) {
		current = vscode.Uri.joinPath(current, segments[i]);
		try {
			await vscode.workspace.fs.createDirectory(current);
		} catch {
			// already exists
		}
	}
}

async function writeUtf8File(workspaceRoot: vscode.Uri, relativePath: string, body: string): Promise<void> {
	await mkdirParentsForFile(workspaceRoot, relativePath);
	const uri = vscode.Uri.joinPath(workspaceRoot, ...pathSegments(relativePath));
	await vscode.workspace.fs.writeFile(uri, encoder.encode(body));
}

function defaultsJson(): string {
	return `{
  "author": "Your Name",
  "siteTitle": "My Book",
  "bylineFormat": "{{Author}} • {{Year}}"
}
`;
}

function stackFileContent(slug: string): string {
	return `${slug}/index.html
${slug}/chapter-01.html
`;
}

function indexHtmlContent(slug: string): string {
	return `---
title: My Book
summary: Short description for LLM stacks and SEO.
---

<h1>My Book</h1>

<p class="byline">{{Author}} • {{Year}}</p>

<p>Replace this intro. Add chapters by creating HTML files under <code>articles/${slug}/</code> and listing them in <code>stacks/book.mastack</code> (after the index line).</p>

<h2>Chapters</h2>

<div class="chapter-list">
    <!-- Chapter links are inserted here when you run Rebuild Dynamic Story -->
</div>

<nav class="nav-bottom">
    <span class="nav-disabled">← Previous</span>
    <a href="index.html">Index</a>
    <span class="nav-disabled">Next →</span>
</nav>
`;
}

function chapterStubContent(): string {
	return `<h1>Chapter 1</h1>

<p>Edit this chapter or add more files and reference them in <code>stacks/book.mastack</code>.</p>
`;
}

function gitignoreIgnoresPasteboardLine(line: string, fileName: string): boolean {
	const t = line.trim();
	return t === fileName || t === `/${fileName}` || t.endsWith(`/${fileName}`);
}

function gitignoreIgnoresDistLine(line: string): boolean {
	const t = line.trim();
	return (
		t === 'dist' ||
		t === 'dist/' ||
		t === '/dist' ||
		t === '/dist/' ||
		t === '**/dist' ||
		t === '**/dist/'
	);
}

/** Ensure `.gitignore` contains MorphArray rules: `pasteboard_test.txt` and `dist/` (append or create). */
async function ensureMorphArrayGitignore(
	workspaceRoot: vscode.Uri,
	created: string[],
	skipped: string[],
): Promise<void> {
	const uri = vscode.Uri.joinPath(workspaceRoot, '.gitignore');
	const lines = (await fileExists(uri))
		? utf8Decoder.decode(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/)
		: [];

	const hasPasteboard = lines.some((l) => gitignoreIgnoresPasteboardLine(l, PASTEBOARD_TEST_FILE));
	const hasDist = lines.some(gitignoreIgnoresDistLine);

	if (hasPasteboard && hasDist) {
		skipped.push('.gitignore (MorphArray rules already present)');
		return;
	}

	const blocks: string[] = [];
	if (!hasPasteboard) {
		blocks.push(`# MorphArray: local pasteboard scratch file\n${PASTEBOARD_TEST_FILE}`);
	}
	if (!hasDist) {
		blocks.push('# MorphArray: Rebuild Dynamic Story output\ndist/');
	}

	const text = lines.join('\n');
	const sep = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
	const suffix = blocks.join('\n\n') + '\n';
	await vscode.workspace.fs.writeFile(
		uri,
		encoder.encode(text.length > 0 ? `${text}${sep}${suffix}` : suffix),
	);
	created.push('.gitignore');
}

async function ensurePasteboardTestFile(
	workspaceRoot: vscode.Uri,
	created: string[],
	skipped: string[],
): Promise<void> {
	const uri = vscode.Uri.joinPath(workspaceRoot, PASTEBOARD_TEST_FILE);
	if (await fileExists(uri)) {
		skipped.push(PASTEBOARD_TEST_FILE);
		return;
	}
	const body = `# ${PASTEBOARD_TEST_FILE}\n# Paste Mental Stack output here while debugging; this file is gitignored.\n`;
	await vscode.workspace.fs.writeFile(uri, encoder.encode(body));
	created.push(PASTEBOARD_TEST_FILE);
}

async function copyExtensionFileIfMissing(
	context: vscode.ExtensionContext,
	relativeFromExtension: string,
	destRelativeToWorkspace: string,
	workspaceRoot: vscode.Uri,
	created: string[],
	skipped: string[],
): Promise<void> {
	const destUri = vscode.Uri.joinPath(workspaceRoot, ...pathSegments(destRelativeToWorkspace));
	if (await fileExists(destUri)) {
		skipped.push(destRelativeToWorkspace);
		return;
	}
	const srcUri = vscode.Uri.joinPath(context.extensionUri, ...pathSegments(relativeFromExtension));
	let bytes: Uint8Array;
	try {
		bytes = await vscode.workspace.fs.readFile(srcUri);
	} catch {
		skipped.push(`${destRelativeToWorkspace} (extension file missing: ${relativeFromExtension})`);
		return;
	}
	await mkdirParentsForFile(workspaceRoot, destRelativeToWorkspace);
	await vscode.workspace.fs.writeFile(destUri, bytes);
	created.push(destRelativeToWorkspace);
}

/**
 * Creates starter layout in the **opened workspace folder** so you mainly customize
 * `defaults.json`, `stacks/book.mastack`, and `articles/book/index.html`.
 */
export async function initializeBookWorkspace(context: vscode.ExtensionContext): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		void vscode.window.showErrorMessage('MorphArray: Open a folder first, then run Initialize Book Workspace.');
		return;
	}

	const slug = DEFAULT_BOOK_SLUG;
	const created: string[] = [];
	const skipped: string[] = [];

	const tasks: Array<{ rel: string; body: string }> = [
		{ rel: 'defaults.json', body: defaultsJson() },
		{ rel: `stacks/book.mastack`, body: stackFileContent(slug) },
		{ rel: `articles/${slug}/index.html`, body: indexHtmlContent(slug) },
		{ rel: `articles/${slug}/chapter-01.html`, body: chapterStubContent() },
	];

	for (const { rel, body } of tasks) {
		const uri = vscode.Uri.joinPath(workspaceRoot, ...pathSegments(rel));
		if (await fileExists(uri)) {
			skipped.push(rel);
			continue;
		}
		await writeUtf8File(workspaceRoot, rel, body);
		created.push(rel);
	}

	await copyExtensionFileIfMissing(
		context,
		'templates/base.html',
		'templates/base.html',
		workspaceRoot,
		created,
		skipped,
	);
	await copyExtensionFileIfMissing(
		context,
		'templates/base.css',
		'templates/base.css',
		workspaceRoot,
		created,
		skipped,
	);

	await ensureMorphArrayGitignore(workspaceRoot, created, skipped);
	await ensurePasteboardTestFile(workspaceRoot, created, skipped);

	if (created.length === 0) {
		void vscode.window.showInformationMessage(
			'MorphArray: Book scaffold skipped — everything already exists (including .gitignore rules and pasteboard file).',
		);
		return;
	}

	const msg = `MorphArray: Book workspace ready. Created or updated ${created.length} path(s). Edit defaults.json, stacks/book.mastack, and articles/${slug}/index.html.`;
	void vscode.window.showInformationMessage(msg);

	if (skipped.length > 0) {
		void vscode.window.showWarningMessage(
			`MorphArray: Skipped ${skipped.length} path(s) (already present or unavailable): ${skipped.join(', ')}`,
		);
	}
}
