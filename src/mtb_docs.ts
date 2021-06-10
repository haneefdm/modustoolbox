import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BaseTreeNode } from './base_tree_node';
export class MTBDocEntry extends BaseTreeNode {
    protected children: MTBDocEntry[] = [];

    constructor(public readonly title:string, protected uri: vscode.Uri | null, parent?: BaseTreeNode) {
        super(parent);
    }

    public getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem> {
        const item = new vscode.TreeItem(this.title, vscode.TreeItemCollapsibleState.None);
        if (this.uri) {
			item.command = { command: 'mtbDocs.openDoc', title: `Open ${this.uri.path}`, arguments: [this], };
			item.contextValue = 'doc';
            item.tooltip = this.uri.toString(true);
        }
        return item;
    }

    public getChildren(): MTBDocEntry[] | Promise<MTBDocEntry[]> {
        return this.children;
    }

    public addChild(child: MTBDocEntry) {
        this.children.push(child);
    }

    public openDoc() {
        if (this.uri) {
            try {
                vscode.env.openExternal(this.uri);
            } catch {
                vscode.window.showErrorMessage(`Could not open ${this.uri.toString(true)}`);
            }
        }
    }
}
export class MTBDocsProvider implements vscode.TreeDataProvider<MTBDocEntry> {
	private _onDidChangeTreeData: vscode.EventEmitter<MTBDocEntry | undefined | void> = new vscode.EventEmitter<MTBDocEntry | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<MTBDocEntry | undefined | void> = this._onDidChangeTreeData.event;

    protected allDocs : MTBDocEntry[] = [];
    constructor() {
        this.getWorkspaceDocs();
    }

    getTreeItem(element: MTBDocEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
    getChildren(element?: MTBDocEntry): vscode.ProviderResult<MTBDocEntry[]> {
        return element ? element.getChildren() : this.allDocs ;
    }

    private static createDummyNode(msg: string) {
        const dummy = new MTBDocEntry(msg, null);
        return dummy;
    }

    private getWorkspaceDocs() {
        this.allDocs = [MTBDocsProvider.createDummyNode(`Updating MTB docs...`)];
        this._onDidChangeTreeData.fire();
        const titleRexp = new RegExp('<title>(.+?)</title>', 'm');
        vscode.workspace.findFiles("**/index.html").then((uris: vscode.Uri[]) => {
            this.allDocs = [];
            for (const uri of uris) {
                try {
                    if (uri.fsPath && fs.existsSync(uri.fsPath)) {
                        const contents = fs.readFileSync(uri.fsPath, 'utf-8');
                        const match = titleRexp.exec(contents);
                        if (match) {
                            const title = match[1];
                            this.allDocs.push(new MTBDocEntry(title, uri));
                        } else {
                            console.log(contents);
                        }
                    }
                } catch (e) {
                    console.log(e);
                }
            }
            this._onDidChangeTreeData.fire();
        }, (reason) => {
            this.allDocs = [MTBDocsProvider.createDummyNode(`No documents found ${reason}`)];
            this._onDidChangeTreeData.fire();
        });
    }

    public refresh() {
        this.getWorkspaceDocs();
    }
}
export class MTBDocs {
	constructor(context: vscode.ExtensionContext) {
        const treeDataProvider = new MTBDocsProvider();
        context.subscriptions.push(vscode.window.createTreeView('mtbDocs', { treeDataProvider }));
		vscode.commands.registerCommand('mtbDocs.openDoc', (doc) => this.openResource(doc));
        vscode.commands.registerCommand('mtbDocs.refresh', () => treeDataProvider.refresh());
        vscode.workspace.onDidChangeWorkspaceFolders(e => {
            treeDataProvider.refresh();
        });
    }

	private openResource(doc: MTBDocEntry): void {
		vscode.window.showInformationMessage(`Clicked on ${doc.title}!`);
        doc.openDoc();
	}
}

