import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BaseTreeNode } from './base_tree_node';
export class MTBDocEntry extends BaseTreeNode {
    protected children: MTBDocEntry[] = [];

    constructor(
        public readonly title: string,
        public uri: vscode.Uri | null,
        parent?: BaseTreeNode) {
        super(parent);
    }

    public getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem> {
        const state = (this.isLeaf() ? vscode.TreeItemCollapsibleState.None :
             vscode.TreeItemCollapsibleState.Expanded);
        const item = new vscode.TreeItem(this.title, state);
        if (this.uri && this.isLeaf()) {
			item.command = { command: 'mtbDocs.openDoc', title: `Open ${this.uri.path}`, arguments: [this], };
			item.contextValue = 'doc';
            item.tooltip = this.uri.toString(true);
        } else if (this.uri) {
			item.contextValue = 'folder';
            item.tooltip = this.uri.fsPath;            
        }
        return item;
    }

    public getChildren(): MTBDocEntry[] {
        return this.children;
    }

    public addChild(child: MTBDocEntry): void {
        this.children.push(child);
    }

    public openDoc(): void {
        if (this.uri && this.isLeaf()) {
            try {
                vscode.env.openExternal(this.uri);
            } catch {
                vscode.window.showErrorMessage(`Could not open ${this.uri.toString(true)}`);
            }
        }
    }

    public isLeaf(): boolean {
        return this.children.length === 0;
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
        const wsName = vscode.workspace.name || 'workspace';
        this.allDocs = [MTBDocsProvider.createDummyNode(`Updating ${wsName} docs...`)];
        this._onDidChangeTreeData.fire();
        const titleRexp = new RegExp('<title>(.+?)</title>', 'm');

        const wsFolders: MTBDocEntry[] = [];
        for (const folder of (vscode.workspace.workspaceFolders || [])) {
            wsFolders.push(new MTBDocEntry(folder.name, folder.uri));
        }
        vscode.workspace.findFiles("**/index.html").then((uris: vscode.Uri[]) => {
            this.allDocs = [];
            for (const uri of uris) {
                try {
                    if (uri.fsPath && fs.existsSync(uri.fsPath)) {
                        const contents = fs.readFileSync(uri.fsPath, 'utf-8');
                        const match = titleRexp.exec(contents);
                        if (match) {
                            const relPath = vscode.workspace.asRelativePath(uri, false);
                            // Make sure file belongs to a ws-folder
                            if (relPath && (relPath !== uri.fsPath)) {
                                const folder = uri.fsPath.slice(0, -(relPath.length+1));
                                const ix = wsFolders.findIndex((e) => e.uri?.fsPath === folder);
                                if (ix >= 0) {
                                    const title = match[1];
                                    wsFolders[ix].addChild(new MTBDocEntry(title, uri, wsFolders[ix]));
                                    // this.allDocs.push(new MTBDocEntry(title, uri));
                                }
                            }
                        } else {
                            console.log(contents);
                        }
                    }
                } catch (e) {
                    console.log(e);
                }
            }
            this.allDocs = wsFolders.filter((e) => e.getChildren().length !== 0);
            const nItems = this.allDocs.length;
            if (nItems === 0) {
                this.makeNoDocsEntry('');
            } else if (nItems === 1) {
                // Only one item, so collapse it
                this.allDocs = this.allDocs[0].getChildren();
            }
            this._onDidChangeTreeData.fire();
        }, (reason) => {
            this.makeNoDocsEntry(reason);
            this._onDidChangeTreeData.fire();
        });
    }

    private makeNoDocsEntry(reason: any) {
        this.allDocs = [MTBDocsProvider.createDummyNode(`No documents found ${reason}`)];
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

