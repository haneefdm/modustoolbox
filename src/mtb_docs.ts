import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { BaseTreeNode } from './base_tree_node';
import { ModusToolboxExtension } from './extension';
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
            const shortPath = ModusToolboxExtension.tildify(this.uri.path);
            const title = `Open '${shortPath}'`;
            item.command = { command: 'mtbDocs.openDoc', title: title, arguments: [this], };
			item.contextValue = 'doc';
            item.tooltip = title;
            item.iconPath = new vscode.ThemeIcon('file');
        } else if (this.uri) {
            item.iconPath = new vscode.ThemeIcon('file-directory');
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
        child.parent = this;
    }

    public openURL(fsPath: string) {
        let opener;

        switch (process.platform) {
            case 'darwin':
                opener = 'open';
                break;
            case 'win32':
                // opener = 'start ""';  // Apparently a bug in VSCode encoding in urls needs an empty string
                opener = 'start';
                break;
            default:
                opener = 'xdg-open';
                break;
        }

        fsPath = fsPath.replace(/"/g, '\\\"');
        const cmd = `${opener} "${fsPath}"`;
        childProcess.exec(cmd, (error) => {
            if (error) {
                console.log(error.message);
                vscode.window.showErrorMessage(error.message);
            }
        });
    }

    public openDoc(): void {
        if (this.uri && this.isLeaf()) {
            try {
                // vscode.env.openExternal(this.uri);  // broken in VSCode 1.57
                this.openURL(this.uri.fsPath);
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
            // The returned values is unpredictable and seems almost random
            uris.sort((a: vscode.Uri, b: vscode.Uri) => a.fsPath === b.fsPath ? 0 : (a.fsPath < b.fsPath ? -1 : 1));
            for (const uri of uris) {
                try {
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
                            }
                        }
                    } else {
                        // console.log(contents);
                    }
                } catch (e) {
                    console.log(e);
                    vscode.window.showErrorMessage(e.message);
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

