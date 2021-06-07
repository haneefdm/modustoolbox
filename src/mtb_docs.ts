import { match, throws } from 'assert';
import * as childProcess from 'child_process';
import * as vscode from 'vscode';

export abstract class BaseTreeNode {
    protected expanded: boolean;
    
    constructor(protected readonly parent?: BaseTreeNode) {
        this.expanded = false;
    }

    public getParent(): BaseTreeNode | undefined {
        return this.parent;
    }

    public abstract getChildren(): BaseTreeNode[] | Promise<BaseTreeNode[]>;
    public abstract getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem>;
    
    public getCommand(): vscode.Command | undefined {
        return undefined;
    }
}

export class MtbDocEntry extends BaseTreeNode {
    protected children: MtbDocEntry[] = [];
    protected name: string = '??';
    protected description: string = '';

    constructor(protected uri: vscode.Uri, parent?: BaseTreeNode) {
        super(parent);
    }

    public getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem> {
        const state = (this.children && this.children.length > 0) ?
            (this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
            : vscode.TreeItemCollapsibleState.None;
        
        const item = new vscode.TreeItem(this.name, state);
        item.description = this.description || this.name;
        item.contextValue = this.name;

        return item;
    }

    public getChildren(): MtbDocEntry[] | Promise<MtbDocEntry[]> {
        return this.children;
    }

    public addChild(child: MtbDocEntry) {
        this.children.push(child);
    }
}

enum StateType {
    lookingForHeaderStart = 0,
    headerMode,
    lookingForVariables
}

export class DocNode {
    private _name: string = '';
    get name() { return this._name; }
    set name(v: string) { this._name = v; }

    public varMap : { [key: string]: string } = {};
}

class DocDict { [dictName: string]: DocNode };

export class MtbDocsProvider implements vscode.TreeDataProvider<MtbDocEntry> {
    protected allDocs : MtbDocEntry[] = [];
    onDidChangeTreeData?: vscode.Event<void | MtbDocEntry | null | undefined> | undefined;
    getTreeItem(element: MtbDocEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
    getChildren(element?: MtbDocEntry): vscode.ProviderResult<MtbDocEntry[]> {
        return element ? element.getChildren() : this.allDocs ;
    }

    public static populateTree(): DocDict | null {
        try {
            const spawnRet = childProcess.spawnSync('make', ['get_app_info']);
            const output = spawnRet.stdout.toString();
            const lines = output.split(/[\r\n]+/g);

            const regExp = new RegExp('^([^=]+)=(.*)$', 'g');
            const dictionaries : DocDict = {};
            let curNode: DocNode | null = null;
            let state = StateType.lookingForHeaderStart;

            let header = '';
            let variables = {};
            for (const _line of lines) {
                if (!_line) { continue; }
                const line = _line.trim();

                if (state === StateType.lookingForHeaderStart) {
                    if (line.startsWith('==')) {
                        state = StateType.headerMode;
                        curNode = null;
                    }
                } else if (state === StateType.headerMode) {
                    if (!line.startsWith('==')) {
                        state = StateType.headerMode;
                        curNode = null;
                    } else {
                        curNode = new DocNode();
                        curNode.name = line;
                        state = StateType.lookingForVariables;
                        dictionaries[line] = curNode;
                    }
                } else if (!line.startsWith('==')) {
                    state = StateType.headerMode;
                    curNode = null;
                } else if ((state === StateType.lookingForVariables) && curNode) {
                    const results = regExp.exec(line);
                    if (results && (results.length === 2)) {
                        // results[1] can be an empty string, meaning existence of a variable
                        curNode.varMap[results[0]] = results[1];
                    } else {
                        console.log('Unexpected line: ', line);
                    }
                } else {
                    console.log(`Unexpected: state = ${state}: ` + line);
                }
            }

            return dictionaries;
        } catch (e) {
            console.log(e);
        }
        return null;
    }
}

export class MtbDocs {
	constructor(context: vscode.ExtensionContext) {
		const treeDataProvider = new MtbDocsProvider();
		context.subscriptions.push(vscode.window.createTreeView('MTB Documents', { treeDataProvider }));
		vscode.commands.registerCommand('modustoolbox.openFile', (resource) => this.openResource(resource));
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource);
	}
}
