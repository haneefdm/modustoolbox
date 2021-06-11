import * as vscode from 'vscode';

export abstract class BaseTreeNode {
    protected expanded: boolean;

    constructor(protected parent?: BaseTreeNode) {
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
