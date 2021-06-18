import * as childProcess from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import * as vscode from 'vscode';
import {BaseTreeNode} from './base_tree_node';
import {ModusToolboxExtension} from './extension';

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

class XMLNodeHelpers {
    public static getElement(node: any, nm: string, raw: boolean = false): string | any[] | null {
        if (nm in node) {
            const ret = node[nm];
            if (raw || !Array.isArray(ret) || (ret.length > 1)) {
                return ret;
            }
            return ret[0];
        }
        return null;
    }

    public static getElementArray(node: any, nm: string, raw: boolean = false): any[] {
        if (nm in node) {
            const ret = node[nm];
            if (Array.isArray(ret)) {
                return ret;
            }
        }
        return [];
    }

    public static getElementStr(node: any, nm: string, raw: boolean = false): string {
        const tmp = XMLNodeHelpers.getElement(node, nm, raw);
        return (typeof tmp === 'string') ? tmp : '';
    }

    public static getElementAttr(node: any, attr: string): string {
        const dollar = '$';
        if (dollar in node) {
            return XMLNodeHelpers.getElementStr(node[dollar], attr);

        }
        return '';
    }
}
class Configurator {
    static displayNameProp = 'display_name';
    static newConfigEnabledProp = 'new_configuration_enabled';
    static supportedxtensionsProp = 'supported_file_extensions';
    static supportedxtensionProp = 'supported_file_extension';
    static iconFileProp = 'icon';
    static idProp = 'id';

    public displayName: string;
    public needsConfigFile;
    public extensions: string[] = [];
    public defaultExt: string = '';
    public iconFile = '';

    constructor (
        public readonly toolsDir: string,
        public readonly id: string,
        public readonly data: any)
    {
        this.id = XMLNodeHelpers.getElementAttr(data, Configurator.idProp) || this.id;
        this.displayName = XMLNodeHelpers.getElementStr(data, Configurator.displayNameProp) || '?huh?';
        this.needsConfigFile = XMLNodeHelpers.getElementStr(data, Configurator.newConfigEnabledProp).toLocaleLowerCase() === 'true';

        this.iconFile = XMLNodeHelpers.getElementStr(data, Configurator.iconFileProp);
        if (this.iconFile !== '') {
            this.iconFile = path.join(toolsDir, id, this.iconFile);
        }

        const exts = XMLNodeHelpers.getElementArray(data, Configurator.supportedxtensionsProp);
        for (const elt of exts) {
            let ext = XMLNodeHelpers.getElement(elt, Configurator.supportedxtensionProp);
            if (typeof ext === 'object') {
                const isDefault = XMLNodeHelpers.getElementAttr(ext, 'default') === 'true';
                ext = XMLNodeHelpers.getElementStr(ext, '_');
                if (!this.defaultExt || isDefault) {
                    this.defaultExt = ext;
                }
            }
            if (ext) {
                this.extensions.push(ext);
            }
        }
        console.log(`${this.displayName}: ${this.extensions}`);
    }
};

class MTBAppInfoParser {
    public static readonly libMgrId: string  = 'library-manager';
    public static getProperties(fsPath: string): Promise<SectionNodes | null> {
        return new Promise((resolve, reject) => {
            try {
                const make = ModusToolboxExtension.makeProgram;
                childProcess.exec(`"${make}" get_app_info`, {cwd: fsPath}, (err, stdout, stderr) => {
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

    public static getConfigurators(fsPath: string): Promise<Configurator[] | null> {
        return new Promise((resolve, reject) => {
            MTBAppInfoParser.getProperties(fsPath).then((sections) => {
                if (!sections) {
                    return resolve(null);
                }

                // NB: This seems pural. How does this work?
                // const configFile = sections.matchSectionVar('', /.+\/CONFIGURATOR_FILES$/);
                // if (!configFile) { return resolve([]); }

                let toolsDir = sections.matchSectionVar('', /.+\/CY_TOOLS_DIR$/);
                if (!toolsDir) {
                    toolsDir = sections.matchSectionVar('', /.+\/CY_TOOLS_PATH$/);
                }
                if (!toolsDir) { return resolve([]); }

                const allConfigs = [MTBAppInfoParser.libMgrId];
                MTBAppInfoParser.getToolsList(sections, allConfigs);

                const configObjs: Configurator[] = [];
                for (const tool of allConfigs) {
                    const version = MTBAppInfoParser.getVersion(toolsDir, tool);
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
                                            configObjs.push(new Configurator(toolsDir || '', tool, conf));
                                        }
                                    }
                                }
                            });
                        } catch (e) {
                        }
                    } else if (tool === MTBAppInfoParser.libMgrId) {
                        // Fake an object
                        const v = version ? version : '';          
                        const conf = {
                            '$': { id: MTBAppInfoParser.libMgrId},
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            display_name: [`Library Manager` + (version ? ' ' + version : '')],
                            executable: [ MTBAppInfoParser.libMgrId],
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            // command_line_args: ['--config=$CONFIG_FILE'],
                            version: [ version || '' ]
                        };
                        configObjs.push(new Configurator(toolsDir, tool, conf));
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

export class MTBToolEntry extends BaseTreeNode {
    static displayNameProp = 'display_name';
    static cmdLineArgsProp = 'command_line_args';
    static exeNameProp = 'executable';

    public fsPath: string = '';
    protected children: MTBToolEntry[] = [];

    constructor(
        protected obj: Configurator | null,
        public readonly uri: vscode.Uri | null,
        parent?: BaseTreeNode) {
        super(parent);
        this.fsPath = uri?.fsPath || '';
    }

    public addChild(child: MTBToolEntry): void {
        this.children.push(child);
        child.parent = this;
    }

    private getProp(nm: string, raw: boolean = false): string | any[] | null {
        if (this.obj && (nm in this.obj.data)) {
            const ret = this.obj.data[nm];
            if (raw) { return ret; }
            return ret[0];
        }
        return null;
    }

    public displayName(): string {
        if (this.isLeaf()) {
            const ret = this.getProp(MTBToolEntry.displayNameProp);
            return (typeof(ret) === 'string') ? ret : '??';
        } else {
            return path.basename(this.fsPath);
        }
    }

    public exeName(): string {
        const prop = this.getProp(MTBToolEntry.exeNameProp);
        const ret = (typeof(prop) === 'string') ? prop : '';
        return ret;
    }

    public cmdLineArgs(): string[] {
        const args = this.getProp(MTBToolEntry.cmdLineArgsProp, true) || [];
        const ret: string[] = [];
        for (const arg of args) {
            if (typeof(arg) === 'string') {
                ret.push(arg);
            }
        }
        return ret;
    }

    public getTreeItem() : vscode.TreeItem | Promise<vscode.TreeItem> {
        const state = (this.isLeaf() ? vscode.TreeItemCollapsibleState.None :
             vscode.TreeItemCollapsibleState.Expanded);
        const item = new vscode.TreeItem(this.displayName(), state);
        if (this.isLeaf() && this.obj && (this.obj.id !== '')) {
			item.command = {command: 'modustoolbox.mtbTools.openTool', title: `Open ${this.displayName()}`, arguments: [this]};
			item.contextValue = 'tool';
            item.tooltip = `Open '${this.displayName()}'`;
            // item.iconPath = this.fsPath;
        } else {
            item.tooltip = this.fsPath;
        }
        return item;
    }

    public getChildren(): MTBToolEntry[] | Promise<MTBToolEntry[]> {
        return this.children;
    }
    
    public isLeaf() {
        return this.children.length === 0;
    }

    private execToolWithCmd(cmd:string) {
        if (this.isLeaf()) {
            console.log(`Running: ${cmd}`);
            childProcess.exec(cmd, {cwd: this.fsPath}, (error) => {
                if (error) {
                    console.log(error.message);
                    vscode.window.showErrorMessage(error.message);
                }
            });
        }
    }

    public execTool(): void {
        let id = this.obj?.id || null;
        if (!this.obj || !id) { return; }

        const make = ModusToolboxExtension.makeProgram;
        const extensions = this.obj.extensions;
        if (id === MTBAppInfoParser.libMgrId) {
            this.execToolWithCmd(`"${make}" modlibs`);
        } else if (true || !extensions || (extensions.length === 0)) {
            this.execToolWithCmd(`"${make}" open "CY_OPEN_TYPE=${id}"`);
        } else {
            const fsPath = (os.platform() === 'win32') ? this.fsPath.replace(/\\/g,'/') : this.fsPath;
            const exts = (extensions.length === 1) ? extensions[0] : `{${extensions.join(',')}}`;
            // const glob = `${fsPath}/**/*.${exts}`;
            const glob = `**/*.${exts}`;
            vscode.workspace.findFiles(glob).then((uris: vscode.Uri[]) => {
                if (uris.length !== 0) {
                    if (uris.length > 1) {
                        const all = uris.map((uri) => uri.fsPath);
                        const options: vscode.QuickPickOptions = {
                            canPickMany: false,
                            placeHolder: all[0],
                            title: 'Multiple configurator files found. Please select one'
                        };
                        vscode.window.showQuickPick(all, options).then((path) => {
                            this.execToolWithCmd(`"${make}" open "CY_OPEN_TYPE=${id}" "CY_OPEN_FILE=${path}"`);
                        });
                    } else {
                        this.execToolWithCmd(`"${make}" open "CY_OPEN_TYPE=${id}" "CY_OPEN_FILE=${uris[0].fsPath}"`);
                    }
                    // for (const uri of uris) {
                    //     console.log(uri.fsPath);
                    //     if (uri.fsPath.startsWith(fsPath)) {
                    //         this.execToolWithCmd(`"${make}" open "CY_OPEN_TYPE=${id}" "CY_OPEN_FILE=${uri.fsPath}"`);
                    //         return;
                    //     }
                    // }
                } else {
                    this.execToolWithCmd(`make open "CY_OPEN_TYPE=${id}"`);
                }
            });
        }
    }
}

export class MTBToolsProvider implements vscode.TreeDataProvider<MTBToolEntry> {
	private _onDidChangeTreeData: vscode.EventEmitter<MTBToolEntry | undefined | void> = new vscode.EventEmitter<MTBToolEntry | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<MTBToolEntry | undefined | void> = this._onDidChangeTreeData.event;

    protected toolsDict : { [path: string]: MTBToolEntry[] } = {};
    protected allTools : MTBToolEntry[] = [];
    protected updatingFolders : MTBToolEntry[] = [];
    protected ownerView: vscode.TreeView<MTBToolEntry> | null = null;
    constructor() {
        this.getWorkspaceTools();
    }

    public setOwner(obj: vscode.TreeView<MTBToolEntry>) {
        this.ownerView = obj;
    }

    /**
     * For those un-iniitated in Node.js and asynchronous programming, a word of caution.
     * We launch make for all the workspace folders (generally just one interesting one)
     * and they produce output on their own time. At the same time, we are keeping track
     * of what is currently running and refreshing the GUI
     */
    private getWorkspaceTools() {
        this.toolsDict = {};
        this.updatingFolders = [];
        this.allTools = [];
        for (const folder of (vscode.workspace.workspaceFolders || [])) {
            const fsPath: string = folder.uri.fsPath;
            const mtbStuff = path.join(fsPath, '.mtbLaunchConfigs');
            const curEntry = new MTBToolEntry(null, folder.uri);
            if (fs.existsSync(mtbStuff)) {
                const msg = `Updating ${path.basename(fsPath)} ...`;
                this.updatingFolders.push(MTBToolsProvider.createDummyNode(msg));
                this._onDidChangeTreeData.fire();
                this.getToolsForPath(folder.uri).then((tools) => {
                    if (tools && (tools.length !== 0)) {
                        this.toolsDict[fsPath] = tools;
                        this.allTools.push(curEntry);
                        for (const tool of tools) {
                            curEntry.addChild(tool);
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
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const raw = new Configurator('', '', { display_name: [msg] });
        const dummy = new MTBToolEntry(raw, null);
        return dummy;
    }

    public getToolsForPath(uri: vscode.Uri): Promise<MTBToolEntry[] | null> {
        return new Promise((resolve, reject) => {
            MTBAppInfoParser.getConfigurators(uri.fsPath).then((rawConfigs) => {
                if (!rawConfigs || (rawConfigs.length === 0)) {
                    return resolve(null);
                }

                const ret: MTBToolEntry[] = [];
                for (const obj of rawConfigs) {
                    const entry = new MTBToolEntry(obj, uri);
                    ret.push(entry);
                }
                return resolve(ret);
            });
        });
    }
    public refresh() {
		this.getWorkspaceTools();
    }
}

export class MTBTools {
    public treeView: vscode.TreeView<MTBToolEntry>;
    public treeDataProvider = new MTBToolsProvider();
	constructor(context: vscode.ExtensionContext) {
        function addDisp(item: vscode.Disposable) {
            context.subscriptions.push(item);
            return item;
        }

        this.treeView = vscode.window.createTreeView('modustoolbox.mtbTools', { treeDataProvider: this.treeDataProvider });
        addDisp(this.treeView);
        this.treeDataProvider.setOwner(this.treeView);

		addDisp(vscode.commands.registerCommand('modustoolbox.mtbTools.openTool', (tool) => tool.execTool()));
        addDisp(vscode.commands.registerCommand('modustoolbox.mtbTools.refresh', () => this.treeDataProvider.refresh()));
        addDisp(vscode.workspace.onDidChangeWorkspaceFolders(e => {
            // We could be smart and act on what changed (added or removed). Let us brute force for now
            this.treeDataProvider.refresh();
        }));
    }
}
