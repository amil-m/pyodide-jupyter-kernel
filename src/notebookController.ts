import * as vscode from "vscode";
import { ExecutionManager } from "./executionManager";
export class PyodideNotebookController {
  private controller: vscode.NotebookController;
  private executionManager: ExecutionManager;
  constructor(executionManager: ExecutionManager) {
    this.executionManager = executionManager;
    this.controller = vscode.notebooks.createNotebookController(
      "pyodide-kernel",
      "jupyter-notebook",
      "Pyodide (Python in Browser)",
    );
    this.controller.supportedLanguages = ["python"];
    this.controller.supportsExecutionOrder = true;
    this.controller.description =
      "Run Python code in the browser using Pyodide";
    this.controller.executeHandler = this.executeHandler.bind(this);
  }
  private async executeHandler(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController,
  ): Promise<void> {
    for (const cell of cells) {
      await this.executeCell(cell, notebook, controller);
    }
  }
  private async executeCell(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController,
  ): Promise<void> {
    const execution = controller.createNotebookCellExecution(cell);
    execution.executionOrder = this.executionManager.getNextExecutionCount();
    execution.start(Date.now());
    try {
      const code = cell.document.getText();
      // Execute code via execution manager, passing notebook URI for relative path resolution
      const outputs = await this.executionManager.executeCode(
        code,
        cell.document.uri.toString(),
        notebook.uri,
      );
      // Convert to notebook outputs
      const notebookOutputs =
        this.executionManager.convertOutputsToNotebookOutputs(outputs);
      // Replace cell outputs
      execution.replaceOutput(notebookOutputs);
      execution.end(true, Date.now());
    } catch (error) {
      // Handle execution error
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error({
            name: "ExecutionError",
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
          }),
        ]),
      ]);
      execution.end(false, Date.now());
    }
  }
  dispose() {
    this.controller.dispose();
  }
}
