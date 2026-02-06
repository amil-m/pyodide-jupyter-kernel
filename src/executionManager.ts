import * as vscode from "vscode";
import {
  ExecutionOutput,
  ExecutionRequest,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  KernelStatus,
} from "./types";

export class ExecutionManager {
  private executions = new Map<
    string,
    {
      resolve: (outputs: ExecutionOutput[]) => void;
      reject: (error: Error) => void;
    }
  >();

  private worker: Worker | undefined;
  private workerReady = false;
  private workerReadyPromise: Promise<void>;
  private workerReadyResolve!: () => void;
  private webview: vscode.Webview | undefined;
  private executionCount = 0;
  private currentStatus: KernelStatus = "idle";
  private activeNotebookUri: vscode.Uri | undefined;
  private mountedFiles: Array<{
    vscodePath: string;
    pyodidePath: string;
    timestamp: number;
  }> = [];

  constructor(private extensionUri: vscode.Uri) {
    this.workerReadyPromise = new Promise((resolve) => {
      this.workerReadyResolve = resolve;
    });
    this.initializeWorker();
  }

  private async initializeWorker() {
    try {
      const workerUri = vscode.Uri.joinPath(
        this.extensionUri,
        "dist",
        "pyodide-worker.js",
      );
      const workerCode = await vscode.workspace.fs.readFile(workerUri);
      const workerCodeText = new TextDecoder().decode(workerCode);
      const blob = new Blob([workerCodeText], {
        type: "application/javascript",
      });
      const blobUrl = URL.createObjectURL(blob);

      this.worker = new Worker(blobUrl);
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      this.worker.postMessage({
        type: "initialize",
        cdnUrl: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.js",
      });

      this.updateStatus("initializing");
    } catch (error) {
      console.error("Failed to initialize worker:", error);
      this.updateStatus("error");
      throw error;
    }
  }

  private handleWorkerMessage(event: MessageEvent) {
    const message = event.data;

    switch (message.type) {
      case "initialized":
        this.workerReady = true;
        this.workerReadyResolve();
        this.updateStatus("ready");
        console.log(`Pyodide kernel ready, version: ${message.version}`);
        break;

      case "status":
        this.updateStatus(message.status);
        break;

      case "result":
        this.handleExecutionResult(message.id, message);
        break;

      case "error":
        this.handleExecutionError(message.id, message.error);
        break;

      case "mountRequest":
        this.handleMountFile(
          message.requestId,
          message.vscodePath,
          message.pyodidePath,
        );
        break;

      case "fileMounted":
        // Track mounted file regardless of whether webview is open
        if (message.success) {
          const existing = this.mountedFiles.findIndex(
            (f) => f.pyodidePath === message.pyodidePath,
          );
          const entry = {
            vscodePath: message.path,
            pyodidePath: message.pyodidePath,
            timestamp: Date.now(),
          };
          if (existing >= 0) {
            this.mountedFiles[existing] = entry;
          } else {
            this.mountedFiles.push(entry);
          }
        }

        if (this.webview) {
          this.webview.postMessage({
            type: "fileMounted",
            requestId: message.requestId,
            path: message.path,
            pyodidePath: message.pyodidePath,
            success: message.success,
          });
        }
        break;
    }
  }

  private handleWorkerError(error: ErrorEvent) {
    console.error("Worker error:", error);
    this.updateStatus("error");
  }

  private updateStatus(status: KernelStatus) {
    this.currentStatus = status;
    if (this.webview) {
      this.webview.postMessage({
        type: "statusUpdate",
        status,
      });
    }
  }

  setWebview(webview: vscode.Webview) {
    this.webview = webview;
    this.webview.postMessage({
      type: "statusUpdate",
      status: this.currentStatus,
    });
  }

  getCurrentStatus(): KernelStatus {
    return this.currentStatus;
  }

  async executeCode(
    code: string,
    cellId: string,
    notebookUri?: vscode.Uri,
  ): Promise<ExecutionOutput[]> {
    if (!this.worker) {
      throw new Error("Worker not initialized");
    }

    if (!this.workerReady) {
      await this.workerReadyPromise;
    }

    // Track which notebook is executing so mount() can resolve relative paths
    this.activeNotebookUri = notebookUri;

    const executionId = `exec-${Date.now()}-${Math.random()}`;

    return new Promise((resolve, reject) => {
      this.executions.set(executionId, { resolve, reject });

      this.worker!.postMessage({
        type: "execute",
        id: executionId,
        code,
      });
    });
  }

  private async handleMountFile(
    requestId: string,
    vscodePath: string,
    pyodidePath: string,
  ) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      // Normalize: strip leading slashes, treat as relative
      let normalizedPath = vscodePath;
      while (normalizedPath.startsWith("/")) {
        normalizedPath = normalizedPath.substring(1);
      }

      let uri: vscode.Uri | undefined;

      // 1) Try resolving relative to the notebook's directory
      if (this.activeNotebookUri) {
        const notebookDir = vscode.Uri.joinPath(this.activeNotebookUri, "..");
        const candidate = vscode.Uri.joinPath(notebookDir, normalizedPath);
        try {
          await vscode.workspace.fs.stat(candidate);
          uri = candidate;
          console.log("[mount] Resolved relative to notebook:", uri.toString());
        } catch {
          // File not found relative to notebook — fall through
        }
      }

      // 2) Fall back to workspace root
      if (!uri && workspaceFolders && workspaceFolders.length > 0) {
        const candidate = vscode.Uri.joinPath(
          workspaceFolders[0].uri,
          normalizedPath,
        );
        try {
          await vscode.workspace.fs.stat(candidate);
          uri = candidate;
          console.log(
            "[mount] Resolved relative to workspace:",
            uri.toString(),
          );
        } catch {
          // Not found here either
        }
      }

      if (!uri) {
        throw new Error(
          `File "${vscodePath}" not found relative to notebook or workspace root`,
        );
      }

      const fileContent = await vscode.workspace.fs.readFile(uri);
      console.log("[mount] Read OK, bytes:", fileContent.byteLength);

      if (this.worker) {
        this.worker.postMessage({
          type: "mountFileResult",
          requestId,
          path: vscodePath,
          pyodidePath,
          content: fileContent,
          success: true,
        });
      }
    } catch (error) {
      console.error(`[mount] Failed to read file "${vscodePath}":`, error);

      if (this.worker) {
        this.worker.postMessage({
          type: "mountFileResult",
          requestId,
          path: vscodePath,
          pyodidePath,
          content: null,
          success: false,
          error: String(error),
        });
      }
    }
  }

  handleWebviewReady() {
    if (!this.webview) return;

    this.webview.postMessage({
      type: "statusUpdate",
      status: this.currentStatus,
    });

    for (const file of this.mountedFiles) {
      this.webview.postMessage({
        type: "fileMounted",
        requestId: "",
        path: file.vscodePath,
        pyodidePath: file.pyodidePath,
        success: true,
      });
    }
  }

  handleWebviewMessage(message: any) {
    // Reserved for future webview messages
  }

  private handleExecutionResult(executionId: string, message: any) {
    const pending = this.executions.get(executionId);
    if (!pending) return;

    this.executions.delete(executionId);

    const outputs: ExecutionOutput[] = [];

    if (message.stdout && message.stdout.trim()) {
      outputs.push({
        outputType: "stream",
        name: "stdout",
        text: message.stdout,
      });
    }

    if (message.stderr && message.stderr.trim()) {
      outputs.push({
        outputType: "stream",
        name: "stderr",
        text: message.stderr,
      });
    }

    if (message.displayOutputs && Array.isArray(message.displayOutputs)) {
      const normalizedDisplayOutputs = message.displayOutputs.map(
        (output: any) => {
          const normalized: any = { ...output };
          if (output.output_type) {
            normalized.outputType = output.output_type;
            delete normalized.output_type;
          }
          return normalized;
        },
      );
      outputs.push(...normalizedDisplayOutputs);
    }

    if (message.result && message.result !== "None" && message.result.trim()) {
      outputs.push({
        outputType: "execute_result",
        data: {
          "text/plain": message.result,
        },
      });
    }

    if (outputs.length === 0) {
      outputs.push({
        outputType: "execute_result",
        data: {
          "text/plain": "",
        },
      });
    }

    pending.resolve(outputs);
  }

  private handleExecutionError(executionId: string, error: any) {
    const pending = this.executions.get(executionId);
    if (!pending) return;

    this.executions.delete(executionId);

    const errorOutput: ExecutionOutput = {
      outputType: "error",
      ename: error.name || "PythonError",
      evalue: error.message || "Unknown error",
      traceback: error.traceback
        ? error.traceback.split("\n").filter((line: string) => line.trim())
        : [],
    };

    pending.resolve([errorOutput]);
  }

  async restartKernel(): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }

    this.workerReady = false;
    this.workerReadyPromise = new Promise((resolve) => {
      this.workerReadyResolve = resolve;
    });

    for (const [id, pending] of this.executions) {
      pending.reject(new Error("Kernel restarted"));
    }
    this.executions.clear();

    await this.initializeWorker();
  }

  convertOutputsToNotebookOutputs(
    outputs: ExecutionOutput[],
  ): vscode.NotebookCellOutput[] {
    return outputs.map((output) => {
      switch (output.outputType) {
        case "stream":
          return new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(output.text || "", "text/plain"),
          ]);

        case "execute_result":
        case "display_data":
          if (output.data && typeof output.data === "object") {
            const items: vscode.NotebookCellOutputItem[] = [];

            for (const [mimeType, value] of Object.entries(output.data)) {
              if (mimeType === "image/png" || mimeType === "image/jpeg") {
                const base64Data = value as string;
                const binaryData = this.base64ToUint8Array(base64Data);
                items.push(
                  new vscode.NotebookCellOutputItem(binaryData, mimeType),
                );
              } else if (mimeType === "text/html") {
                items.push(
                  vscode.NotebookCellOutputItem.text(
                    value as string,
                    "text/html",
                  ),
                );
              } else if (mimeType === "text/plain") {
                items.push(
                  vscode.NotebookCellOutputItem.text(
                    value as string,
                    "text/plain",
                  ),
                );
              } else if (mimeType === "image/svg+xml") {
                items.push(
                  vscode.NotebookCellOutputItem.text(
                    value as string,
                    "image/svg+xml",
                  ),
                );
              } else if (mimeType === "application/json") {
                const jsonStr =
                  typeof value === "string"
                    ? value
                    : JSON.stringify(value, null, 2);
                items.push(
                  vscode.NotebookCellOutputItem.text(
                    jsonStr,
                    "application/json",
                  ),
                );
              } else {
                const strValue =
                  typeof value === "string" ? value : JSON.stringify(value);
                items.push(
                  vscode.NotebookCellOutputItem.text(strValue, mimeType),
                );
              }
            }

            return new vscode.NotebookCellOutput(items);
          } else {
            const resultText =
              typeof output.data === "string"
                ? output.data
                : JSON.stringify(output.data);
            return new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.text(resultText, "text/plain"),
            ]);
          }

        case "error":
          return new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.error({
              name: output.ename || "Error",
              message: output.evalue || "Unknown error",
              stack: output.traceback?.join("\n") || "",
            }),
          ]);

        default:
          return new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(
              "Unknown output type",
              "text/plain",
            ),
          ]);
      }
    });
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const base64Data = base64.replace(
      /^data:image\/(png|jpeg|jpg);base64,/,
      "",
    );
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  getNextExecutionCount(): number {
    return ++this.executionCount;
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }
  }
}
