/** Result of parsing an HTML article with optional YAML frontmatter. */
export interface ParsedArticleMatter {
	data: Record<string, unknown>;
	content: string;
}

/** Options for `formatArticleSection` (plain-text block layout). */
export interface ArticleSectionFormatOptions {
	index: number;
	total: number;
	relativePath: string;
	title: string;
	date: string;
	summary: string;
	body: string;
}
