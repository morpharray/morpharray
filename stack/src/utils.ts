import * as vscode from 'vscode';
import * as cheerio from 'cheerio';
import matter from 'gray-matter';
import { TextDecoder } from 'node:util';
import type { ParsedArticleMatter } from './types.js';

const utf8Decoder = new TextDecoder('utf8');

/** Stack definition files: primary `.mastack`, plus `.mstack` for common typo/existing repos. */
export function isStackDefinitionFile(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.endsWith('.mastack') || lower.endsWith('.mstack');
}

export function getWorkspaceRoot(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function decodeBuffer(data: Uint8Array): string {
	return utf8Decoder.decode(data);
}

export function stripUtf8Bom(text: string): string {
	if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
		return text.slice(1);
	}
	return text;
}

/**
 * HTML article body for Turndown: drop `script`/`style`, strip inline `style`, prefer `<body>` inner HTML so the
 * converter does not see a full document wrapper.
 */
export function prepareArticleHtmlFragmentForTurndown(html: string): string {
	const $ = cheerio.load(html);
	$('style, script').remove();
	$('*').removeAttr('style');
	const body = $('body');
	if (body.length > 0) {
		return body.first().html() ?? '';
	}
	return $.root()
		.children()
		.toArray()
		.map((el) => $.html(el))
		.join('');
}

/**
 * Line-based frontmatter when strict YAML fails (e.g. `title: Part one: Part two` — unquoted colons in values break js-yaml).
 * Splits each line on the *first* `:` only; strips optional wrapping quotes on the value.
 */
export function tryParseLooseYamlFrontmatter(text: string): ParsedArticleMatter | undefined {
	const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
	if (!m) {
		return undefined;
	}
	const yamlBlock = m[1];
	const content = m[2];
	const data: Record<string, unknown> = {};
	for (const line of yamlBlock.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const idx = trimmed.indexOf(':');
		if (idx === -1) {
			continue;
		}
		const key = trimmed.slice(0, idx).trim();
		if (!key) {
			continue;
		}
		let value = trimmed.slice(idx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1);
		}
		data[key] = value;
	}
	return { data, content };
}

/**
 * Reads HTML + YAML frontmatter: tries gray-matter first, then a lenient line parser for LLM-style values (titles with colons, etc.).
 */
export function parseArticleMatter(fileText: string): ParsedArticleMatter {
	const text = stripUtf8Bom(fileText);
	try {
		const parsed = matter(text);
		return { data: parsed.data as Record<string, unknown>, content: parsed.content };
	} catch (strictErr) {
		const loose = tryParseLooseYamlFrontmatter(text);
		if (loose) {
			return loose;
		}
		throw strictErr;
	}
}

/** First matching line wins: `# CHAPTER_START_INDEX=0` (0-based) or `=1` (default book style). */
const CHAPTER_START_INDEX_DIRECTIVE =
	/^\s*#\s*CHAPTER_START_INDEX\s*=\s*(\d+)\s*$/i;

/** First matching line wins: `# AUTHOR_NAME="Name"` (quotes optional). Overrides `defaults.json` author for builds. */
const AUTHOR_NAME_DIRECTIVE = /^\s*#\s*AUTHOR_NAME\s*=\s*(.*)$/i;

/** First matching line wins: relative/absolute URL from the built index page to the site library (e.g. `"../../morpharray_library.html"`). */
const LIBRARY_PATH_DIRECTIVE = /^\s*#\s*LIBRARY_PATH\s*=\s*(.*)$/i;

function parseStackDirectiveStringValue(raw: string): string {
	let v = raw.trim();
	if (!v) {
		return '';
	}
	if (
		(v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
		(v.startsWith("'") && v.endsWith("'") && v.length >= 2)
	) {
		return v.slice(1, -1).trim();
	}
	return v;
}

/** One path line in a `.mastack` after parsing; `attributes` come from trailing `# k=v, k2=v2`. */
export interface MastackPathLine {
	path: string;
	/** Keys normalized to lowercase. */
	attributes: Record<string, string>;
}

/**
 * Parses `pub=2026-04-04, something_else=value` (comma-separated, `=` splits key/value). Quotes on values optional.
 */
export function parseInlineStackAttributes(attrsText: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of attrsText.split(',')) {
		const segment = part.trim();
		if (!segment) {
			continue;
		}
		const eq = segment.indexOf('=');
		if (eq === -1) {
			continue;
		}
		const key = segment.slice(0, eq).trim().toLowerCase();
		let val = segment.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
			(val.startsWith("'") && val.endsWith("'") && val.length >= 2)
		) {
			val = val.slice(1, -1).trim();
		}
		if (key) {
			out[key] = val;
		}
	}
	return out;
}

/**
 * Splits `articles/ch.html # pub=2026-04-04, tag=draft` into path + attributes (CSS-like comma list after `#`).
 */
export function splitMastackPathLine(line: string): MastackPathLine {
	const trimmed = line.trim();
	const m = trimmed.match(/^(.+?)\s+#\s+(.+)$/);
	if (!m) {
		return { path: trimmed, attributes: {} };
	}
	return { path: m[1].trim(), attributes: parseInlineStackAttributes(m[2]) };
}

/**
 * Merge stack line attributes with article frontmatter for template placeholders (`pub` → `date` for `{{date}}`).
 */
export function buildPlaceholderContextFromArticleAndStack(
	defaults: Record<string, string>,
	articleData: Record<string, unknown>,
	stackAttributes: Record<string, string>,
): Record<string, string> {
	const ctx: Record<string, string> = { ...defaults };
	const fmDate = formatFrontmatterValue(articleData['date']) || '';
	if (fmDate) {
		ctx['date'] = fmDate;
	}
	for (const [k, v] of Object.entries(stackAttributes)) {
		ctx[k] = v;
	}
	if (stackAttributes['pub'] !== undefined && stackAttributes['pub'] !== '') {
		ctx['date'] = stackAttributes['pub'];
	} else if (stackAttributes['date']) {
		ctx['date'] = stackAttributes['date'];
	}
	return ctx;
}

/** `YYYY-MM-DD` → locale long date (e.g. April 4, 2026); other strings passed through. */
export function formatStackDateForDisplay(value: string): string {
	const t = value.trim();
	const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!iso) {
		return t;
	}
	const y = Number(iso[1]);
	const mo = Number(iso[2]) - 1;
	const da = Number(iso[3]);
	const d = new Date(y, mo, da);
	if (Number.isNaN(d.getTime())) {
		return t;
	}
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Replace `{{Year}}`, `{{date}}`, `{{Author}}`, … and any `{{token}}` matching keys in `ctx` (token = ASCII letters/digits/underscore). Context values are substituted as-is (no HTML escaping). */
export function applyTemplatePlaceholders(html: string, ctx: Record<string, string>): string {
	const year = new Date().getFullYear().toString();
	const author = ctx['author'] ?? '';
	const siteTitle = ctx['siteTitle'] ?? '';
	const dateRaw = ctx['date'] ?? '';
	const dateDisplay = dateRaw ? formatStackDateForDisplay(dateRaw) : '';
	const byline = author
		? dateDisplay
			? `${author} • ${dateDisplay}`
			: `${author} • ${year}`
		: dateDisplay
			? dateDisplay
			: year;

	let out = html
		.replace(/\{\{Year\}\}/gi, year)
		.replace(/\{\{year\}\}/g, year)
		.replace(/\{\{Author\}\}/gi, author)
		.replace(/\{\{author\}\}/g, author)
		.replace(/\{\{Byline\}\}/gi, byline)
		.replace(/\{\{byline\}\}/g, byline)
		.replace(/\{\{siteTitle\}\}/gi, siteTitle)
		.replace(/\{\{SiteTitle\}\}/gi, siteTitle)
		.replace(/\{\{dateIso\}\}/gi, dateRaw)
		.replace(/\{\{DateIso\}\}/gi, dateRaw)
		.replace(/\{\{date\}\}/gi, dateDisplay)
		.replace(/\{\{Date\}\}/gi, dateDisplay);

	for (const [key, val] of Object.entries(ctx)) {
		if (key === 'date') {
			// {{date}} uses formatted display above; avoid overwriting with raw ISO.
			continue;
		}
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
			continue;
		}
		const re = new RegExp(
			`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`,
			'gi',
		);
		out = out.replace(re, val);
	}
	return out;
}

/**
 * Parses non-empty, non-comment lines from a stack definition file.
 * Paths are relative to `articles/` (e.g. topic1/article1.html). Trailing `# attrs` stripped.
 */
export function parseStackDefinitionLines(text: string): string[] {
	const lines: string[] = [];
	for (const line of stripUtf8Bom(text).split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		lines.push(splitMastackPathLine(trimmed).path);
	}
	return lines;
}

/**
 * Like {@link parseStackDefinitionLines}, but recognizes stack directives (see below).
 *
 * - `# CHAPTER_START_INDEX=<n>` — non-negative integer; default `1` if omitted or invalid (index list labels only).
 * - `# AUTHOR_NAME="..."` — optional quotes; when present (even empty), overrides workspace `defaults.json` author.
 * - `# LIBRARY_PATH="..."` — optional quotes; href from the **built index** to the library page (append link at bottom of index in **Rebuild**).
 * - Path lines may end with `# k=v, k2=v2` (comma-separated). `pub=YYYY-MM-DD` fills `{{date}}` on that page.
 */
export function parseStackDefinitionForSiteBuild(text: string): {
	/** Index line first, then chapters; paths trimmed to `articles/` rel paths. */
	entries: MastackPathLine[];
	chapterStartIndex: number;
	/** Set only if an `AUTHOR_NAME` directive appeared (use empty string to clear author). */
	authorName: string | undefined;
	/** Set only if `LIBRARY_PATH` appeared; empty string allowed but appends no link. */
	libraryPath: string | undefined;
} {
	const DEFAULT_START = 1;
	let chapterStartIndex = DEFAULT_START;
	let chapterIndexLocked = false;
	let authorName: string | undefined;
	let authorNameLocked = false;
	let libraryPath: string | undefined;
	let libraryPathLocked = false;
	const entries: MastackPathLine[] = [];

	for (const line of stripUtf8Bom(text).split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const authorMatch = trimmed.match(AUTHOR_NAME_DIRECTIVE);
		if (authorMatch) {
			if (!authorNameLocked) {
				authorName = parseStackDirectiveStringValue(authorMatch[1] ?? '');
				authorNameLocked = true;
			}
			continue;
		}
		const libraryMatch = trimmed.match(LIBRARY_PATH_DIRECTIVE);
		if (libraryMatch) {
			if (!libraryPathLocked) {
				libraryPath = parseStackDirectiveStringValue(libraryMatch[1] ?? '');
				libraryPathLocked = true;
			}
			continue;
		}
		const dirMatch = trimmed.match(CHAPTER_START_INDEX_DIRECTIVE);
		if (dirMatch) {
			if (!chapterIndexLocked) {
				const n = Number.parseInt(dirMatch[1], 10);
				if (Number.isFinite(n)) {
					chapterStartIndex = Math.max(0, n);
					chapterIndexLocked = true;
				}
			}
			continue;
		}
		if (trimmed.startsWith('#')) {
			continue;
		}
		entries.push(splitMastackPathLine(trimmed));
	}
	return { entries, chapterStartIndex, authorName, libraryPath };
}

/**
 * Chapter ordinal for display (plain decimal, no zero-padding). `ordinalInStack` is 0 for the first chapter
 * after the index.
 */
export function formatChapterOrdinalLabel(startIndex: number, ordinalInStack: number): string {
	return String(startIndex + ordinalInStack);
}

export function articleUriFromRelative(workspaceRoot: vscode.Uri, relativeArticlePath: string): vscode.Uri {
	const normalized = relativeArticlePath.replace(/\\/g, '/').trim();
	const segments = normalized.split('/').filter((s) => s.length > 0);
	return vscode.Uri.joinPath(workspaceRoot, 'articles', ...segments);
}

export function formatFrontmatterValue(value: unknown): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value);
}

/** Discovers stack definition files under `stacks/`. */
export async function listStackDefinitionFiles(stacksDir: vscode.Uri): Promise<string[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(stacksDir);
	} catch {
		throw new Error(
			'Could not read the stacks folder. Create a `stacks/` directory in the workspace root and add `.mastack` definition files.',
		);
	}

	const files = entries
		.filter(([, type]) => type === vscode.FileType.File)
		.map(([name]) => name)
		.filter(isStackDefinitionFile)
		.sort((a, b) => a.localeCompare(b));

	return files;
}
