// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as MTBTools from './mtb_tools';
import * as MTBDocs from './mtb_docs';

const commandExistsSync = require('command-exists').sync;
const globSync = require('glob').sync;
export class ModusToolboxExtension {
	public static makeProgram = '';
	public static defaulToolsDir: string = '';
	public static extensionPath: string = '';

	constructor(private context: vscode.ExtensionContext) {
		ModusToolboxExtension.getDefaultToolsDir(this.context);
		ModusToolboxExtension.getMakeProgram(this.context);
		this.activate();
	}

	public static tildify(path: string): string {
		const platform = os.platform();
		if (platform !== 'win32') {
			const home = process.env.HOME;
			if (home && path.startsWith(home)) {
				path = '~' + path.substr(home.length);
			}
		}
		return path;
	}

	private static getDefaultToolsDir(context: vscode.ExtensionContext): string {
		if (ModusToolboxExtension.defaulToolsDir !== '') {
			return ModusToolboxExtension.defaulToolsDir;
		}
		const configuration = vscode.workspace.getConfiguration('modustoolbox');
		ModusToolboxExtension.defaulToolsDir = configuration.toolsPath;
		if (ModusToolboxExtension.defaulToolsDir && (ModusToolboxExtension.defaulToolsDir !== '')) {
			return ModusToolboxExtension.defaulToolsDir;
		}

		const platform = os.platform();
		let installDir = '';
		if (platform === 'darwin') {
			installDir = '/Applications/';
		} else if (platform === 'linux') {
			installDir = context.environmentVariableCollection.get('HOME')?.value || '.';
		} else {
			installDir = context.environmentVariableCollection.get('USERPROFILE')?.value || '.';
		}
		const pat = path.join(installDir, 'ModusToolbox', 'tools_*.*');
		const globbed = globSync(pat).sort();
		if (globbed || globbed.length > 0) {
			ModusToolboxExtension.defaulToolsDir = globbed[globbed.length-1];
		}
		return ModusToolboxExtension.defaulToolsDir;
	}

	private static getMakeProgram(context: vscode.ExtensionContext) {
		if (ModusToolboxExtension.makeProgram !== '') {
			return  ModusToolboxExtension.makeProgram;
		}
		if (commandExistsSync('make')) {
			ModusToolboxExtension.makeProgram = 'make';
			return ModusToolboxExtension.makeProgram;
		}
		const toolsDir = ModusToolboxExtension.getDefaultToolsDir(context);
		const make = path.join(toolsDir, 'modus_shell', 'bin', 'make');
	}

	private activate() {
		ModusToolboxExtension.extensionPath = this.context.extensionPath;
		if (!ModusToolboxExtension.getMakeProgram(this.context)) {
			const winExtra = (os.platform() === 'win32') ? '\nYou can use tools included with your ModusToolbox installation' : '';
			vscode.window.showErrorMessage(`Extension 'modustoolbox' needs 'make' to be in your PATH to work${winExtra}`);
		} else {
			new MTBTools.MTBTools(this.context);
			new MTBDocs.MTBDocs(this.context);
		}
	}
}

export function activate(context: vscode.ExtensionContext) {	
	new ModusToolboxExtension(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}
