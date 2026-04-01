import * as vscode from 'vscode';
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

/**
 * Parses non-empty, non-comment lines from a stack definition file.
 * Paths are relative to `articles/` (e.g. topic1/article1.html).
 */
export function parseStackDefinitionLines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'));
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
