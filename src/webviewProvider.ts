import * as vscode from "vscode";
import { ExecutionManager } from "./executionManager";
import { WebviewToExtensionMessage } from "./types";

export class PyodideWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "pyodide-kernel.statusView";

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private executionManager: ExecutionManager,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist"),
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Register the webview (but don't send state yet — script hasn't loaded)
    this.executionManager.setWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === "webviewReady") {
        // Script has loaded and event listeners are set up — now replay state
        this.executionManager.handleWebviewReady();
      } else if (message.type === "restartKernel") {
        await this.executionManager.restartKernel();
      } else {
        this.executionManager.handleWebviewMessage(message);
      }
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );

    const workerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "pyodide-worker.js"),
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "styles.css"),
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'nonce-${nonce}' 'unsafe-eval'; script-src-elem 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src ${webview.cspSource} https://cdn.jsdelivr.net; img-src ${webview.cspSource} https: data:; worker-src blob:; connect-src https: http://localhost:* http://127.0.0.1:*;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Pyodide Kernel Status</title>
</head>
<body>
  <div class="container">
    <h2>Pyodide Kernel</h2>
    <div class="status-section">
      <label>Status:</label>
      <span id="status" class="status-badge status-idle">Idle</span>
    </div>
    <div class="actions-section">
      <button id="restart-button" class="restart-button" title="Restart the Pyodide kernel (clears all variables)">⟳ Restart Kernel</button>
    </div>
    <div class="info-section">
      <p id="info-text">Kernel will initialize on first cell execution</p>
    </div>
    <div class="mounted-files-section">
      <h3>Mounted Files</h3>
      <div id="mounted-files-list" class="mounted-files-list">
        <div class="no-files">No files mounted</div>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    window.workerScriptUri = '${workerUri}';
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
