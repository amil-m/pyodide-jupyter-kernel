// Webview main script - Displays kernel status and mounted files
declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

// Mounted files tracking
const mountedFiles: Array<{
  vscodePath: string;
  pyodidePath: string;
  timestamp: number;
}> = [];

// UI Elements
const statusElement = document.getElementById("status")!;
const infoElement = document.getElementById("info-text")!;
const mountedFilesListElement = document.getElementById("mounted-files-list")!;
const restartButton = document.getElementById("restart-button")!;

// Handle messages from extension
window.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data;
  switch (message.type) {
    case "statusUpdate":
      updateStatus(message.status);
      break;
    case "fileMounted":
      handleFileMounted(message);
      break;
  }
});

// Update status UI
function updateStatus(status: string, message?: string) {
  statusElement.className = `status-badge status-${status}`;
  statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  if (message) {
    infoElement.textContent = message;
  } else {
    switch (status) {
      case "initializing":
        infoElement.textContent =
          "Loading Pyodide... (this may take a few seconds)";
        break;
      case "ready":
        infoElement.textContent = "Ready to execute Python code";
        break;
      case "busy":
        infoElement.textContent = "Executing code...";
        break;
      case "idle":
        infoElement.textContent = "Ready to execute Python code";
        break;
      case "error":
        infoElement.textContent = "Error - check console for details";
        break;
    }
  }
}

function handleFileMounted(message: any) {
  if (message.success) {
    const existingIndex = mountedFiles.findIndex(
      (f) => f.pyodidePath === message.pyodidePath,
    );
    if (existingIndex >= 0) {
      mountedFiles[existingIndex] = {
        vscodePath: message.path,
        pyodidePath: message.pyodidePath,
        timestamp: Date.now(),
      };
      console.log(`File remounted: ${message.path} -> ${message.pyodidePath}`);
    } else {
      mountedFiles.push({
        vscodePath: message.path,
        pyodidePath: message.pyodidePath,
        timestamp: Date.now(),
      });
      console.log(`File mounted: ${message.path} -> ${message.pyodidePath}`);
    }
    updateMountedFilesList();
  } else {
    console.error(`Failed to mount file: ${message.path}`);
  }
}

function updateMountedFilesList() {
  if (!mountedFilesListElement) return;

  if (mountedFiles.length === 0) {
    mountedFilesListElement.innerHTML =
      '<div class="no-files">No files mounted</div>';
    return;
  }

  mountedFilesListElement.innerHTML = mountedFiles
    .map((file) => {
      const fileName = file.vscodePath.split("/").pop() || file.vscodePath;
      return `
        <div class="mounted-file-item">
          <div class="file-name" title="${file.vscodePath}">${fileName}</div>
          <div class="file-path">${file.pyodidePath}</div>
        </div>
      `;
    })
    .join("");
}

// Restart kernel function
function restartKernel() {
  mountedFiles.length = 0;
  updateMountedFilesList();
  updateStatus("initializing", "Restarting kernel...");
  vscode.postMessage({
    type: "restartKernel",
  });
}

// Hook up restart button
restartButton.addEventListener("click", () => {
  restartKernel();
});

// Initial status
updateStatus("idle", "Kernel will initialize on first cell execution");
updateMountedFilesList();

// Signal to the extension that we're ready to receive messages.
// This must come AFTER all event listeners are set up above.
vscode.postMessage({ type: "webviewReady" });
