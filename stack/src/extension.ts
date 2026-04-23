import * as vscode from 'vscode';
import { createMentalStackFullContext } from './mentalStack.js';
import { createMostRecentArticleList } from './mostRecentArticleList.js';
import { rebuildDynamicStory } from './siteBuilder.js';
import { initializeBookWorkspace } from './workspaceInit.js';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('morpharray.rebuildDynamicStory', () => rebuildDynamicStory(context)),
		vscode.commands.registerCommand('morpharray.createMentalStackFullContext', createMentalStackFullContext),
		vscode.commands.registerCommand('morpharray.initializeBookWorkspace', () => initializeBookWorkspace(context)),
		vscode.commands.registerCommand(
			'morpharray.createMostRecentArticleList',
			createMostRecentArticleList,
		),
	);
}

export function deactivate(): void {}
