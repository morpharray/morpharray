import * as vscode from 'vscode';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import { getWorkspaceRoot, parseArticleMatter, parseStackDefinitionLines } from './utils.js';
import { TextDecoder } from 'node:util';

const utf8Decoder = new TextDecoder('utf8');

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function pathSegments(rel: string): string[] {
	return rel.replace(/\\/g, '/').trim().split('/').filter((s) => s.length > 0);
}

/**
 * Web-safe relative URL from one article path to another (both relative to `articles/`).
 */
function relativeArticleHref(fromArticleRel: string, toArticleRel: string): string {
	const fromDir = path.posix.dirname(fromArticleRel);
	const rel = path.posix.relative(fromDir, toArticleRel);
	if (!rel) {
		return '';
	}
	return rel
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
}

async function loadDefaults(workspaceRoot: vscode.Uri): Promise<Record<string, string>> {
	try {
		const defaultsUri = vscode.Uri.joinPath(workspaceRoot, 'defaults.json');
		const raw = await vscode.workspace.fs.readFile(defaultsUri);
		return JSON.parse(utf8Decoder.decode(raw)) as Record<string, string>;
	} catch {
		return {
			author: '',
			year: new Date().getFullYear().toString(),
			bylineFormat: '{{author}} • {{year}}',
		};
	}
}

function applyPlaceholders(html: string, defaults: Record<string, string>): string {
	const year = new Date().getFullYear().toString();
	const author = defaults['author'] ?? '';
	const siteTitle = defaults['siteTitle'] ?? '';
	const byline = author ? `${author} • ${year}` : year;

	return html
		.replace(/\{\{Year\}\}/gi, year)
		.replace(/\{\{year\}\}/g, year)
		.replace(/\{\{Author\}\}/gi, author)
		.replace(/\{\{author\}\}/g, author)
		.replace(/\{\{Byline\}\}/gi, byline)
		.replace(/\{\{byline\}\}/g, byline)
		.replace(/\{\{siteTitle\}\}/gi, siteTitle)
		.replace(/\{\{SiteTitle\}\}/gi, siteTitle);
}

async function copySiteCss(
	workspaceRoot: vscode.Uri,
	outDir: vscode.Uri,
	context: vscode.ExtensionContext,
): Promise<void> {
	const dest = vscode.Uri.joinPath(outDir, 'base.css');
	const candidates = [
		vscode.Uri.joinPath(workspaceRoot, 'templates', 'base.css'),
		vscode.Uri.joinPath(context.extensionUri, 'templates', 'base.css'),
	];

	for (const src of candidates) {
		try {
			const bytes = await vscode.workspace.fs.readFile(src);
			await vscode.workspace.fs.writeFile(dest, bytes);
			return;
		} catch {
			// try next
		}
	}
}

async function readWorkspaceText(workspaceRoot: vscode.Uri, relativePath: string): Promise<string | undefined> {
	const segments = pathSegments(relativePath);
	if (segments.length === 0) {
		return undefined;
	}
	const uri = vscode.Uri.joinPath(workspaceRoot, 'articles', ...segments);
	try {
		const raw = await vscode.workspace.fs.readFile(uri);
		return utf8Decoder.decode(raw);
	} catch {
		return undefined;
	}
}

async function loadChapterWrapperTemplate(
	workspaceRoot: vscode.Uri,
	context: vscode.ExtensionContext,
): Promise<string | undefined> {
	const candidates = [
		vscode.Uri.joinPath(workspaceRoot, 'templates', 'base.html'),
		vscode.Uri.joinPath(context.extensionUri, 'templates', 'base.html'),
	];
	for (const uri of candidates) {
		try {
			const raw = await vscode.workspace.fs.readFile(uri);
			return utf8Decoder.decode(raw);
		} catch {
			// continue
		}
	}
	return undefined;
}

function cleanArticleBodyHtml(html: string): string {
	const $ = cheerio.load(html);
	$('style, script').remove();
	$('*').removeAttr('style');
	return $.html();
}

function resolveTitle(parsed: ReturnType<typeof parseArticleMatter>, relPath: string): string {
	let title = parsed.data['title'] !== undefined ? String(parsed.data['title']) : '';
	if (!title.trim()) {
		const $ = cheerio.load(parsed.content);
		title = $('h1').first().text().trim();
	}
	if (!title.trim()) {
		title = path.basename(relPath, '.html');
	}
	return title.trim();
}

/** Build `<li><a href="...">...</a></li>` rows for the index page (analogy-style chapter list). */
function buildChapterListItems(chapters: Array<{ title: string; href: string }>): string {
	return chapters
		.map(
			(ch) =>
				`    <li><a href="${escapeHtml(ch.href)}">${escapeHtml(ch.title)}</a></li>`,
		)
		.join('\n');
}

async function mkdirIgnoreError(uri: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.createDirectory(uri);
	} catch {
		// already exists
	}
}

async function writeTextUnderDist(distRoot: vscode.Uri, articleRel: string, html: string): Promise<void> {
	const segments = pathSegments(articleRel);
	if (segments.length === 0) {
		return;
	}
	const outUri = vscode.Uri.joinPath(distRoot, ...segments);
	const parentSegments = segments.slice(0, -1);
	if (parentSegments.length > 0) {
		await mkdirIgnoreError(vscode.Uri.joinPath(distRoot, ...parentSegments));
	}
	await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(html));
}

/**
 * Static site generation: read-only `articles/`, output under `dist/`.
 *
 * **Stack file format** (`stacks/*.mastack`):
 * - **First line**: index / landing template (HTML under `articles/`), same shape as `analogy.html`
 *   (body with a `.chapter-list` container to fill).
 * - **Following lines**: chapter HTML paths under `articles/`, in display order.
 *
 * Output mirrors article paths under `dist/` (e.g. `articles/turndown/index.html` → `dist/turndown/index.html`).
 * Shared stylesheet: `base.css` copied next to the module (e.g. `dist/turndown/base.css`).
 */
export async function rebuildDynamicStory(context: vscode.ExtensionContext): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		void vscode.window.showErrorMessage('MorphArray: Open a folder to rebuild the site.');
		return;
	}

	const defaults = await loadDefaults(workspaceRoot);

	const stacksDir = vscode.Uri.joinPath(workspaceRoot, 'stacks');
	let stackFileNames: string[] = [];
	try {
		const entries = await vscode.workspace.fs.readDirectory(stacksDir);
		stackFileNames = entries
			.filter(([, type]) => type === vscode.FileType.File)
			.map(([name]) => name)
			.filter((name) => name.endsWith('.mastack') || name.endsWith('.mstack'))
			.sort((a, b) => a.localeCompare(b));
	} catch {
		void vscode.window.showErrorMessage('MorphArray: Could not read `stacks/` folder.');
		return;
	}

	if (stackFileNames.length === 0) {
		void vscode.window.showErrorMessage('MorphArray: No `.mastack` files found in `stacks/`.');
		return;
	}

	const picked = await vscode.window.showQuickPick(
		stackFileNames.map((name) => ({ label: name })),
		{ placeHolder: 'Select stack to build', title: 'MorphArray: Rebuild Dynamic Story' },
	);
	if (!picked) {
		return;
	}

	const stackUri = vscode.Uri.joinPath(stacksDir, picked.label);
	let stackContent: string;
	try {
		stackContent = utf8Decoder.decode(await vscode.workspace.fs.readFile(stackUri));
	} catch {
		void vscode.window.showErrorMessage(`MorphArray: Could not read "${picked.label}".`);
		return;
	}

	const relativePaths = parseStackDefinitionLines(stackContent);
	if (relativePaths.length === 0) {
		void vscode.window.showErrorMessage('MorphArray: Stack file has no paths.');
		return;
	}

	const indexTemplateRel = relativePaths[0].trim();
	const chapterRels = relativePaths.slice(1).map((p) => p.trim()).filter(Boolean);

	const indexText = await readWorkspaceText(workspaceRoot, indexTemplateRel);
	if (!indexText) {
		void vscode.window.showErrorMessage(
			`MorphArray: Index template not found: articles/${indexTemplateRel.replace(/\\/g, '/')}`,
		);
		return;
	}

	const distDir = vscode.Uri.joinPath(workspaceRoot, 'dist');
	await mkdirIgnoreError(distDir);

	const moduleDirSegments = pathSegments(path.posix.dirname(indexTemplateRel));
	const moduleOutDir =
		moduleDirSegments.length > 0
			? vscode.Uri.joinPath(distDir, ...moduleDirSegments)
			: distDir;

	await mkdirIgnoreError(moduleOutDir);
	await copySiteCss(workspaceRoot, moduleOutDir, context);

	const chapterTemplateHtml = await loadChapterWrapperTemplate(workspaceRoot, context);

	const chapterMeta: Array<{
		rel: string;
		title: string;
		href: string;
		cleanHtml: string;
	}> = [];

	for (const rel of chapterRels) {
		const raw = await readWorkspaceText(workspaceRoot, rel);
		if (!raw) {
			void vscode.window.showWarningMessage(`MorphArray: Skipping missing article: ${rel}`);
			continue;
		}
		let parsed: ReturnType<typeof parseArticleMatter>;
		try {
			parsed = parseArticleMatter(raw);
		} catch {
			void vscode.window.showWarningMessage(`MorphArray: Skipping (frontmatter error): ${rel}`);
			continue;
		}
		const title = resolveTitle(parsed, rel);
		const href = relativeArticleHref(indexTemplateRel, rel);
		const cleanHtml = cleanArticleBodyHtml(parsed.content);
		chapterMeta.push({ rel, title, href, cleanHtml });
	}

	const indexParsed = parseArticleMatter(indexText);
	const indexTitle = resolveTitle(indexParsed, indexTemplateRel);

	const chapterListHtml = buildChapterListItems(
		chapterMeta.map((c) => ({ title: c.title, href: c.href })),
	);

	let indexFragment = applyPlaceholders(indexParsed.content, defaults);
	const $index = cheerio.load(indexFragment);
	const listHost = $index('.chapter-list').first();
	if (listHost.length > 0) {
		listHost.html(`\n<ul>\n${chapterListHtml}\n</ul>\n`);
	} else {
		$index('body').append(`\n<h2>Chapters</h2>\n<ul>\n${chapterListHtml}\n</ul>\n`);
	}

	let indexInner = $index('body').length > 0 ? ($index('body').html() ?? '') : '';
	indexInner = applyPlaceholders(indexInner, defaults);

	const indexFull = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(indexTitle)}</title>
  <link rel="stylesheet" href="base.css">
</head>
<body>
${indexInner}
</body>
</html>`;

	await writeTextUnderDist(distDir, indexTemplateRel, indexFull);

	let wrapper = chapterTemplateHtml;
	if (!wrapper) {
		wrapper = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <link rel="stylesheet" href="base.css">
</head>
<body>
  <div class="article-content">{{content}}</div>
  <nav class="nav-bottom">{{prev_link}} {{index_link}} {{next_link}}</nav>
</body>
</html>`;
	}

	for (let i = 0; i < chapterMeta.length; i++) {
		const ch = chapterMeta[i];
		const prevRel = i > 0 ? chapterMeta[i - 1].rel : null;
		const nextRel = i < chapterMeta.length - 1 ? chapterMeta[i + 1].rel : null;

		const prevLink = prevRel
			? `<a href="${escapeHtml(relativeArticleHref(ch.rel, prevRel))}">← Previous</a>`
			: `<span class="nav-disabled">← Previous</span>`;
		const nextLink = nextRel
			? `<a href="${escapeHtml(relativeArticleHref(ch.rel, nextRel))}">Next →</a>`
			: `<span class="nav-disabled">Next →</span>`;
		const indexLink = `<a href="${escapeHtml(relativeArticleHref(ch.rel, indexTemplateRel))}">Index</a>`;

		let page = wrapper
			.replace(/\{\{title\}\}/gi, escapeHtml(ch.title))
			.replace(/\{\{main_title\}\}/gi, escapeHtml(ch.title))
			.replace(/\{\{subtitle\}\}/gi, '')
			.replace(/\{\{content\}\}/gi, ch.cleanHtml)
			.replace(/\{\{byline\}\}/gi, applyPlaceholders('{{Byline}}', defaults))
			.replace(/\{\{Byline\}\}/gi, applyPlaceholders('{{Byline}}', defaults))
			.replace(/\{\{image\}\}/gi, '')
			.replace(/\{\{Image\}\}/gi, '')
			.replace(/\{\{prev_link\}\}/gi, prevLink)
			.replace(/\{\{next_link\}\}/gi, nextLink)
			.replace(/\{\{index_link\}\}/gi, indexLink);

		page = applyPlaceholders(page, defaults);
		page = page.replace(/href=(["'])\.\.\/base\.css\1/gi, 'href=$1base.css$1');
		page = page.replace(/href=(["'])css\/base\.css\1/gi, 'href=$1base.css$1');

		await writeTextUnderDist(distDir, ch.rel, page);
	}

	void vscode.window.showInformationMessage(
		`MorphArray: Site rebuilt — index + ${chapterMeta.length} chapter(s) under dist/${moduleDirSegments.join('/') || '.'}`,
	);
}
