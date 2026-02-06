import * as vscode from 'vscode';
import { ExecutionManager } from './executionManager';
import { PyodideNotebookController } from './notebookController';
import { PyodideWebviewProvider } from './webviewProvider';

let executionManager: ExecutionManager;
let notebookController: PyodideNotebookController;
let webviewProvider: PyodideWebviewProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Pyodide Jupyter Kernel extension is now active');

  // Initialize execution manager with extension URI
  executionManager = new ExecutionManager(context.extensionUri);

  // Register webview provider
  webviewProvider = new PyodideWebviewProvider(
    context.extensionUri,
    executionManager
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PyodideWebviewProvider.viewType,
      webviewProvider
    )
  );

  // Register notebook controller
  notebookController = new PyodideNotebookController(executionManager);

  context.subscriptions.push(
    {
      dispose: () => notebookController.dispose()
    },
    {
      dispose: () => executionManager.dispose()
    }
  );

  console.log('Pyodide Jupyter Kernel extension activated successfully');
}

export function deactivate() {
  if (notebookController) {
    notebookController.dispose();
  }
  if (executionManager) {
    executionManager.dispose();
  }
}
