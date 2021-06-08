import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xml2js from 'xml2js';
import * as vscode from 'vscode';

enum StateType {
    start = 0,
    endHeader,
    headerMode,
    variables
}

class SectionNode {
    private _name: string = '';
    public get name() { return this._name; }

    constructor(nm: string) {
        this._name = nm;
    }

    public varMap : { [key: string]: string } = {};
}

class SectionNodes {
    protected sectionMap: { [sectionName: string]: SectionNode} = {};
    private _globalNode: SectionNode = new SectionNode('');
    public get globalNode() { return this._globalNode; }
    
    constructor() {
        this.sectionMap[this.globalNode.name] = this.globalNode;
    }

    public addVar(node: SectionNode, name: string, val: string): void {
        node.varMap[name] = val;
        this.globalNode.varMap[node.name + '/' + name] = val;
        if (!this.sectionMap[node.name]) {
            this.sectionMap[node.name] = node;
        }
    }

    public getSection(name: string): SectionNode {
        return this.sectionMap[name];
    }

    public getSectionNames(): string[] {
        return Object.keys(this.sectionMap);
    }

    /**
     * 
     * @param sectionName - section to search in
     * @param varName - exactvariable name, case sensitive
     * @returns 
     */
    public getSectionVar(sectionName: string, varName: string): string | null {
        const section = this.getSection(sectionName);
        return section ? section.varMap[varName] : null;
    }

    /**
     * 
     * @param sectionName - section name, use '' for global search which are prefixed by section name
     * @param varNameRe - regular expression for variable name
     * @returns variable value including '' or null
     */    
    public matchSectionVar(sectionName: string, varNameRe: RegExp): string | null {
        const section = this.getSection(sectionName);
        if (section) {
            for (const [key, value] of Object.entries(section.varMap)) {
                if (key.match(varNameRe)) {
                    return value;
                }
            }
        }
        return null;
    }

    /**
     * 
     * @param varNameRe - regular expression for variable name in all sections (no globals)
     * @returns and array of matching key, value pairs
     */
    public matchAllSectionVars(varNameRe: RegExp): { [key: string]: string }[]  {
        const ret: { [key: string]: string }[] = [];
        for (const sectionName of this.getSectionNames()) {
            if (sectionName !== '') {
                const section = this.getSection(sectionName);
                for (const [key, value] of Object.entries(section.varMap)) {
                    if (key.match(varNameRe)) {
                        ret.push({key: key, value: value});
                    }
                }
            }
        }
        return ret;
    }
};

class RawTool {
    constructor (
        public readonly toolsDir: string,
        public readonly configFile: string,
        public readonly id: string,
        public readonly data: any) {
    }
};

class Junk {
    public static readonly libraryManager: string  = 'library-manager';
    public static getProperties(fsPath: string): Promise<SectionNodes | null> {
        return new Promise((resolve, reject) => {
            try {
                childProcess.exec('make get_app_info', {cwd: fsPath}, (err, stdout, stderr) => {
                    if (err) {
                        console.log(err);
                        vscode.window.showErrorMessage(err.message);
                        return reject(err);
                    }
                    const lines = stdout.split(/[\r\n]+/g);
                    const dictionaries = new SectionNodes();
                    let curNode: SectionNode | null = null;
                    let state = StateType.start;

                    const regExp = /^([^=]+)=(.*)$/;
                    for (const _line of lines) {
                        if (!_line) { continue; }
                        const line = _line.trim();

                        if (state === StateType.start) {
                            if (line.startsWith('==')) {
                                state = StateType.headerMode;
                                curNode = null;
                            }
                        } else if (state === StateType.headerMode) {
                            if (line.startsWith('==')) {
                                if (curNode) {
                                    // End header mode
                                    state = StateType.variables;
                                }
                            } else {
                                curNode = new SectionNode(line);
                            }
                        } else if (state === StateType.variables) {
                            if (line.startsWith('==')) {
                                state = StateType.headerMode;
                                curNode = null;
                            } else if (curNode) {
                                const match = regExp.exec(line);
                                if (match && (match.length === 3)) {
                                    // match[2] can be an empty string, meaning existence of a variable
                                    dictionaries.addVar(curNode, match[1], match[2]);
                                } else {
                                    console.log(`Unexpected match: '${match}'`);
                                }
                            } else {
                                console.log(`Unexpected line2: '${line}'`);
                            }
                        } else {
                            console.log(`Unexpected: state = ${state}: ` + line);
                        }
                    }
                    resolve(dictionaries);
                });
            } catch (e) {
                console.log(e);
                reject(e);
            }
        });
    }

    public static getConfigurators(fsPath: string): Promise<RawTool[] | null> {
        return new Promise((resolve, reject) => {
            Junk.getProperties(fsPath).then((sections) => {
                if (!sections) {
                    return resolve(null);
                }

                // NB: This seems pural. How does this work?
                const configFile = sections.matchSectionVar('', /.+\/CONFIGURATOR_FILES$/);
                if (!configFile) { return resolve([]); }

                let toolsDir = sections.matchSectionVar('', /.+\/CY_TOOLS_PATH$/);
                if (!toolsDir) {
                    toolsDir = sections.matchSectionVar('', /.+\/CY_TOOLS_DIR$/);
                }
                if (!toolsDir) { return resolve([]); }

                const allConfigs = [Junk.libraryManager];
                Junk.getToolsList(sections, allConfigs);

                const configObjs: RawTool[] = [];
                for (const tool of allConfigs) {
                    const version = Junk.getVersion(toolsDir, tool);
                    const xmlfName = path.join(toolsDir, tool, 'configurator.xml');
                    if (fs.existsSync(xmlfName)) {
                        try {
                            const xmlStr = fs.readFileSync(xmlfName, {encoding: 'utf8'});
                            xml2js.parseString(xmlStr, function(err: any, json: any) {
                                if (!err) {
                                    const configs = json['configurators'] ? json['configurators'].configurator : null;
                                    if (configs && (configs.length > 0)) {
                                        for (const conf of configs) {
                                            if (version) {
                                                conf[`version`] = [ version ];
                                            }
                                            configObjs.push(new RawTool(toolsDir || '', configFile, tool, conf));
                                        }
                                    }
                                }
                            });
                        } catch (e) {
                        }
                    } else if (tool === Junk.libraryManager) {
                        // Fake an object
                        const v = version ? version : '';          
                        const conf = {
                            '$': { id: Junk.libraryManager},
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            display_name: [`Library Manager` + (version ? ' ' + version : '')],
                            executable: [ Junk.libraryManager],
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            // command_line_args: ['--config=$CONFIG_FILE'],
                            version: [ version || '' ]
                        };
                        configObjs.push(new RawTool(toolsDir, configFile, tool, conf));
                    }
                }
                // console.log(configObjs);
                return resolve(configObjs);
            }).catch ((err) => {
                return resolve(null);
            });
        });
    }

    private static getVersion(toolsDir: string, tool: string): string | null {
        let xmlfName = path.join(toolsDir, tool, 'version.xml');
        let version = null;
        if (fs.existsSync(xmlfName)) {
            try {
                const xmlStr = fs.readFileSync(xmlfName, { encoding: 'utf8' });
                xml2js.parseString(xmlStr, function (err: any, json: any) {
                    if (!err && json['version']) {
                        const match = json['version'].match(/(\d+\.\d+)/);
                        version = match ? match[1] : json['version'];
                    }
                });
            } catch (e) {
            }
        }
        return version;
    }

    private static getToolsList(sections: SectionNodes, allConfigs: string[]) {
        const configTools = sections.matchAllSectionVars(/.*SUPPORTED_TOOL_TYPES$/);
        let lastTool = '';
        if (configTools && configTools.length > 0) {
            const allStrs = [];
            for (const tool of configTools) {
                allStrs.push(tool.value);
            }
            const configToolsStr = allStrs.join(' ');
            for (const tool of configToolsStr.split(/\s+/g).sort((a, b) => a.localeCompare(b))) {
                if (lastTool !== tool) {
                    allConfigs.push(tool);
                }
                lastTool = tool;
            }
        }
    }
}

abstract class BaseTreeNode {
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

export class MTBToolEntry extends BaseTreeNode {
    static displayNameProp = 'display_name';
    static exeNameProp = 'executable';
    static cmdLineArgs = 'command_line_args';

    constructor(protected obj: RawTool, public readonly fsPath: string, parent?: BaseTreeNode) {
        super(parent);
    }

    private getProp(nm: string, raw: boolean = false): string | any[] | null {
        if (nm in this.obj.data) {
            const ret = this.obj.data[nm];
            if (raw) { return ret; }
            return ret[0];
        }
        return null;
    }

    public displayName(): string {
        const ret = this.getProp(MTBToolEntry.displayNameProp);
        return (typeof(ret) === 'string') ? ret : '??';
    }

    public exeName(): string {
        const prop = this.getProp(MTBToolEntry.exeNameProp);
        const ret = (typeof(prop) === 'string') ? prop : '';
        return ret;
    }

    public cmdLineArgs(): string[] {
        const args = this.getProp(MTBToolEntry.cmdLineArgs, true) || [];
        const ret: string[] = [];
        for (const arg of args) {
            if (typeof(arg) === 'string') {
                ret.push(arg);
            }
        }
        return ret;
    }

    public getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem> {
        const item = new vscode.TreeItem(this.displayName(), vscode.TreeItemCollapsibleState.None);
        const nm = this.displayName();
        if (nm !== '?') {
			item.command = { command: 'mtbTools.openTool', title: `Open ${nm}`, arguments: [this], };
			item.contextValue = 'tool';
        }
        return item;
    }

    public getChildren(): MTBToolEntry[] | Promise<MTBToolEntry[]> {
        return [];
    }

    public execTool(): void {
        let id = this.obj.id;
        if (id) {
            const target = (id === Junk.libraryManager) ? 'modlibs' : 'open';
            const cmd = `make ${target} "CY_OPEN_TYPE=${id}"`;
            childProcess.exec(cmd, {cwd: this.fsPath}, (error) => {
                if (error) {
                    console.log(error.message);
                    vscode.window.showErrorMessage(error.message);
                }
            });
        }
    }
}

export class MTBToolsProvider implements vscode.TreeDataProvider<MTBToolEntry> {
	private _onDidChangeTreeData: vscode.EventEmitter<MTBToolEntry | undefined | void> = new vscode.EventEmitter<MTBToolEntry | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<MTBToolEntry | undefined | void> = this._onDidChangeTreeData.event;

    // onDidChangeTreeData?: vscode.Event<void | MTBToolEntry | null | undefined> | undefined;
    protected toolsDict : { [path: string]: MTBToolEntry[] } = {};
    protected allTools : MTBToolEntry[] = [];
    protected updatingFolders : MTBToolEntry[] = [];
    constructor() {
        this.getWorkspaceTools();
    }

    /**
     * For those un-iniitated in Node.js and asynchronous programming, a word of caution.
     * We launch make for all the workspace folders (generally just one interesting one)
     * and they produce output on their own time. At the same time, we are keeping track
     * of what is currently running and refreshing the GUI
     */
    private getWorkspaceTools() {
        this.toolsDict = {};
        this.allTools = [];
        for (const folder of (vscode.workspace.workspaceFolders || [])) {
            const fsPath: string = folder.uri.fsPath;
            if (!fsPath) { continue; }

            const mtbStuff = path.join(fsPath, '.mtbLaunchConfigs');
            if (fs.existsSync(mtbStuff)) {
                const msg = `Updating ${path.basename(fsPath)} ...`;
                this.updatingFolders.push(MTBToolsProvider.createDummyNode(msg));
                this._onDidChangeTreeData.fire();
                this.getToolsForPath(fsPath).then((tools) => {
                    if (tools && (tools.length !== 0)) {
                        this.toolsDict[fsPath] = tools;
                        if (this.allTools.length === 0) {
                            this.allTools = tools;
                        }
                    }
                }).finally(() => {
                    // Things can be deleted out of order. Delete the right one!
                    const ix = this.updatingFolders.findIndex((item) => {
                        return item.displayName() === msg;
                    });
                    this.updatingFolders.splice(ix, 1);
                    this._onDidChangeTreeData.fire();
                });
            }
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: MTBToolEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    getChildren(element?: MTBToolEntry): vscode.ProviderResult<MTBToolEntry[]> {
        if (element) {
            return element.getChildren();
        }
        if (this.updatingFolders.length !== 0) {
            return this.updatingFolders;
        } else if (this.allTools.length !== 0) {
            return this.allTools;
        } else {
            const dummy = MTBToolsProvider.createDummyNode('Could not find tools list!!!. Wrong dir?');
            return [ dummy ];
        }
    }

    private static createDummyNode(msg: string) {
        const raw = new RawTool(
            // eslint-disable-next-line @typescript-eslint/naming-convention
            '', '', '', { display_name: [msg] });
        const dummy = new MTBToolEntry(raw, '?');
        return dummy;
    }

    public getToolsForPath(fsPath: string): Promise<MTBToolEntry[] | null> {
        return new Promise((resolve, reject) => {
            Junk.getConfigurators(fsPath).then((rawConfigs) => {
                if (!rawConfigs || (rawConfigs.length === 0)) {
                    return resolve(null);
                }

                const ret: MTBToolEntry[] = [];
                for (const obj of rawConfigs) {
                    const entry = new MTBToolEntry(obj, fsPath);
                    ret.push(entry);
                }
                return resolve(ret);
            });
        });
    }
}

export class MTBTools {
	constructor(context: vscode.ExtensionContext) {
		const treeDataProvider = new MTBToolsProvider();
		context.subscriptions.push(vscode.window.createTreeView('mtbTools', { treeDataProvider }));
		vscode.commands.registerCommand('mtbTools.openTool', (tool) => this.openResource(tool));
	}

	private openResource(tool: MTBToolEntry): void {
		vscode.window.showInformationMessage(`Clicked on ${tool.displayName()}!`);
        tool.execTool();
	}
}
