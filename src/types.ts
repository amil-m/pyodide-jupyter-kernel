// Message types between Extension and Webview

export type ExtensionToWebviewMessage =
  | { type: 'execute'; executionId: string; code: string; cellId: string }
  | { type: 'getStatus' }
  | { type: 'fileData'; requestId: string; path: string; content: Uint8Array; success: boolean; error?: string };

export type WebviewToExtensionMessage =
  | { type: 'ready'; pyodideVersion: string }
  | { type: 'executionResult'; executionId: string; outputs: ExecutionOutput[] }
  | { type: 'executionError'; executionId: string; error: PythonError }
  | { type: 'statusUpdate'; status: KernelStatus }
  | { type: 'mountFile'; requestId: string; path: string };

// Message types between Webview and Worker

export type WebviewToWorkerMessage =
  | { type: 'initialize'; cdnUrl: string }
  | { type: 'execute'; id: string; code: string }
  | { type: 'mountFile'; requestId: string; path: string; content: Uint8Array };

export type WorkerToWebviewMessage =
  | { type: 'initialized'; version: string }
  | { type: 'result'; id: string; result: any; stdout: string; stderr: string; displayOutputs?: ExecutionOutput[] }
  | { type: 'error'; id: string; error: PythonError }
  | { type: 'status'; status: KernelStatus }
  | { type: 'mountRequest'; requestId: string; vscodePath: string; pyodidePath: string }
  | { type: 'fileMounted'; requestId: string; path: string; pyodidePath: string; success: boolean };

// Shared types

export type KernelStatus = 'initializing' | 'ready' | 'busy' | 'idle' | 'error';

export interface PythonError {
  name: string;
  message: string;
  traceback: string;
}

// MIME bundle type - maps MIME types to their data
export interface MimeBundle {
  [mimeType: string]: string | object | any;
}

export interface ExecutionOutput {
  outputType: 'stream' | 'execute_result' | 'error' | 'display_data';
  // For stream outputs
  text?: string;
  name?: string; // 'stdout' or 'stderr' for stream
  // For execute_result and display_data outputs (MIME bundle)
  data?: MimeBundle;
  metadata?: { [mimeType: string]: any };
  // For error outputs
  ename?: string; // error name
  evalue?: string; // error value
  traceback?: string[]; // error traceback lines
}

export interface ExecutionRequest {
  executionId: string;
  code: string;
  cellId: string;
}

export interface ExecutionResult {
  executionId: string;
  outputs: ExecutionOutput[];
  executionCount?: number;
}

export interface MountedFile {
  vscodePath: string;
  pyodidePath: string;
  size: number;
  timestamp: number;
}
