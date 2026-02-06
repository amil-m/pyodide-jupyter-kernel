// Pyodide Worker - Loads Pyodide and executes Python code

interface PyodideInterface {
  runPython(code: string): any;
  runPythonAsync(code: string): Promise<any>;
  loadPackage(packages: string | string[]): Promise<void>;
  globals: any;
  FS: any;
}

declare function loadPyodide(config: {
  indexURL?: string;
}): Promise<PyodideInterface>;

declare function importScripts(...urls: string[]): void;

let pyodide: PyodideInterface | null = null;
let isInitializing = false;
let isInitialized = false;

// =====================================================================
// Mount system: JS-native Promises that Pyodide can await directly
// =====================================================================
const pendingMounts = new Map<
  string,
  {
    resolve: (path: string) => void;
    reject: (error: Error) => void;
  }
>();

/**
 * Called from Python via `from js import requestMount`.
 * Returns a JS Promise that Python can `await` directly.
 * The promise resolves when the extension host sends the file back.
 */
function requestMount(
  requestId: string,
  vscodePath: string,
  pyodidePath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    pendingMounts.set(requestId, { resolve, reject });

    // Ask the extension host to read the file
    self.postMessage({
      type: "mountRequest",
      requestId,
      vscodePath,
      pyodidePath,
    });
  });
}

// Expose to Python's `js` module
(self as any).requestMount = requestMount;

// =====================================================================
// Python display system setup
// =====================================================================
const DISPLAY_SYSTEM_CODE = `
import sys
import io
import base64
import json
import warnings
from io import StringIO

warnings.filterwarnings('ignore', message='.*non-interactive.*')
warnings.filterwarnings('ignore', category=UserWarning, module='matplotlib.*')

class OutputCapture:
    def __init__(self):
        self.stdout = StringIO()
        self.stderr = StringIO()
        self._original_stdout = sys.stdout
        self._original_stderr = sys.stderr

    def start(self):
        self.stdout = StringIO()
        self.stderr = StringIO()
        sys.stdout = self.stdout
        sys.stderr = self.stderr

    def stop(self):
        sys.stdout = self._original_stdout
        sys.stderr = self._original_stderr
        return self.stdout.getvalue(), self.stderr.getvalue()

_output_capture = OutputCapture()

_display_outputs = []

class DisplayPublisher:
    def publish(self, data, metadata=None):
        _display_outputs.append({
            'output_type': 'display_data',
            'data': data,
            'metadata': metadata or {}
        })

_display_pub = DisplayPublisher()

def display(*objs, **kwargs):
    for obj in objs:
        data = {}
        metadata = {}

        if hasattr(obj, '_repr_html_'):
            data['text/html'] = obj._repr_html_()

        if hasattr(obj, '_repr_png_'):
            png_data = obj._repr_png_()
            if isinstance(png_data, tuple):
                png_data, png_metadata = png_data
                metadata['image/png'] = png_metadata
            if png_data:
                data['image/png'] = base64.b64encode(png_data).decode('ascii')

        if hasattr(obj, '_repr_jpeg_'):
            jpeg_data = obj._repr_jpeg_()
            if isinstance(jpeg_data, tuple):
                jpeg_data, jpeg_metadata = jpeg_data
                metadata['image/jpeg'] = jpeg_metadata
            if jpeg_data:
                data['image/jpeg'] = base64.b64encode(jpeg_data).decode('ascii')

        if hasattr(obj, '_repr_svg_'):
            data['image/svg+xml'] = obj._repr_svg_()

        data['text/plain'] = repr(obj)

        if len(data) > 1:
            _display_pub.publish(data, metadata)
        else:
            print(obj)

def capture_matplotlib():
    try:
        import matplotlib
        import matplotlib.pyplot as plt

        try:
            matplotlib.use('Agg')
        except:
            pass

        fig = plt.gcf()

        if fig.get_axes():
            buf = io.BytesIO()
            fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
            buf.seek(0)
            png_data = buf.getvalue()
            buf.close()

            b64_data = base64.b64encode(png_data).decode('ascii')

            _display_outputs.append({
                'output_type': 'display_data',
                'data': {
                    'image/png': b64_data,
                    'text/plain': '<Figure>'
                },
                'metadata': {}
            })

            plt.close(fig)
            return True
    except ImportError:
        pass
    except Exception as e:
        print(f"Error capturing matplotlib figure: {e}", file=sys.stderr)
    return False

def get_display_outputs():
    global _display_outputs
    outputs = _display_outputs.copy()
    _display_outputs = []
    return outputs

async def install_package(package_name):
    import micropip
    import sys
    from io import StringIO

    old_stdout = sys.stdout
    sys.stdout = StringIO()

    try:
        await micropip.install(package_name)
        sys.stdout = old_stdout
        print(f"\\u2713 {package_name} installed successfully")

        if 'matplotlib' in package_name.lower():
            try:
                import matplotlib
                matplotlib.use('Agg')
            except:
                pass
    except Exception as e:
        sys.stdout = old_stdout
        print(f"\\u2717 Failed to install {package_name}: {e}")
        raise

async def pip(package_name):
    import micropip
    await micropip.install(package_name)

    if 'matplotlib' in package_name.lower():
        try:
            import matplotlib
            matplotlib.use('Agg')
            print("Configured matplotlib to use Agg backend")
        except:
            pass

import builtins
builtins.display = display
builtins.install_package = install_package
builtins.pip = pip
builtins.capture_matplotlib = capture_matplotlib
builtins.get_display_outputs = get_display_outputs
`;

// =====================================================================
// Python mount() function — awaits a JS Promise directly
// =====================================================================
const MOUNT_SYSTEM_CODE = `
import os
import builtins

_mount_request_id = 0

class MountResult:
    """
    Awaitable wrapper around the mount coroutine.
    Provides helpful errors if the user forgets 'await'.
    """

    def __init__(self, coro, vscode_path, pyodide_path):
        self._coro = coro
        self._vscode_path = vscode_path
        self._pyodide_path = pyodide_path
        self._awaited = False

    def __await__(self):
        self._awaited = True
        return self._coro.__await__()

    def __str__(self):
            if not self._awaited:
                return (
                    f"ERROR: mount() must be awaited!\\n"
                    f"  Use: path = await mount('{self._vscode_path}')\\n"
                    f"  Not: path = mount('{self._vscode_path}')"
                )
            return self._pyodide_path

    def __repr__(self):
        if not self._awaited:
            return (
                f"ERROR: mount() must be awaited!\\n"
                f"  Use: path = await mount('{self._vscode_path}')\\n"
                f"  Not: path = mount('{self._vscode_path}')"
            )
        return f"MountResult('{self._vscode_path}' -> '{self._pyodide_path}')"

    def __del__(self):
        if not self._awaited:
            import warnings
            warnings.warn(
                f"mount('{self._vscode_path}') was never awaited. "
                f"Use: await mount('{self._vscode_path}')",
                RuntimeWarning,
                stacklevel=1
            )
            # Close the coroutine to suppress the default unawaited warning
            self._coro.close()

async def _mount_impl(request_id, vscode_path, pyodide_path):
    """Internal async implementation of mount."""
    from js import requestMount

    result_path = await requestMount(request_id, vscode_path, pyodide_path)

    if not os.path.exists(str(result_path)):
        raise FileNotFoundError(
            f"Mount completed but file not found at {result_path}. "
            f"This may indicate a filesystem write error."
        )

    print(f"\\u2713 Mounted {vscode_path} \\u2192 {result_path}")
    return str(result_path)

def mount(vscode_path, pyodide_path=None):
    """
    Mount a file from the VSCode workspace into Pyodide's virtual filesystem.
    Must be awaited.

    Args:
        vscode_path: Path relative to workspace root (e.g., 'data.csv' or 'subdir/data.csv')
        pyodide_path: Optional target path in Pyodide FS. Defaults to /<basename>.

    Returns:
        The pyodide_path where the file is now available.

    Example:
        path = await mount('data.csv')
        df = pd.read_csv(path)

        await mount('subdir/data.csv', '/mydata.csv')
        df = pd.read_csv('/mydata.csv')
    """
    global _mount_request_id

    if pyodide_path is None:
        pyodide_path = '/' + os.path.basename(vscode_path)
    if not pyodide_path.startswith('/'):
        pyodide_path = '/' + pyodide_path

    _mount_request_id += 1
    request_id = f"mount_{_mount_request_id}"

    coro = _mount_impl(request_id, vscode_path, pyodide_path)
    return MountResult(coro, vscode_path, pyodide_path)

builtins.mount = mount
`;

async function setupDisplaySystem() {
  if (!pyodide) return;
  try {
    pyodide.runPython(DISPLAY_SYSTEM_CODE);
  } catch (error) {
    console.error("Failed to setup display system:", error);
    throw error;
  }
}

function setupMountSystem() {
  if (!pyodide) return;
  try {
    pyodide.runPython(MOUNT_SYSTEM_CODE);
  } catch (error) {
    console.error("Failed to setup mount system:", error);
    throw error;
  }
}

// =====================================================================
// Message handler
// =====================================================================
self.addEventListener("message", async (event: MessageEvent) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case "initialize":
        await initializePyodide(
          msg.cdnUrl ||
            "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.js",
        );
        break;

      case "execute":
        await executeCode(msg.id, msg.code);
        break;

      case "mountFileResult":
        // Extension host has read the file (or failed) — resolve the JS Promise
        handleMountFileResult(msg);
        break;
    }
  } catch (error: any) {
    self.postMessage({
      type: "error",
      id: msg.id,
      error: {
        name: error.name || "Error",
        message: error.message || "Unknown error",
        traceback: error.stack || "",
      },
    });
  }
});

/**
 * Called when the extension host responds to a mountRequest.
 * Writes the file to Pyodide FS and resolves the pending JS Promise,
 * which unblocks the Python `await mount(...)`.
 */
function handleMountFileResult(msg: any) {
  const {
    requestId,
    path: vscodePath,
    pyodidePath,
    content,
    success,
    error: errorMsg,
  } = msg;

  const pending = pendingMounts.get(requestId);
  if (!pending) {
    console.warn("[mount] No pending mount for requestId:", requestId);
    return;
  }
  pendingMounts.delete(requestId);

  if (!success || !content) {
    pending.reject(
      new Error(
        `Failed to read "${vscodePath}" from workspace: ${errorMsg || "unknown error"}`,
      ),
    );
    return;
  }

  try {
    // Ensure target directory exists
    pyodide!.runPython(`
import os
_d = os.path.dirname('${pyodidePath}')
if _d and not os.path.exists(_d):
    os.makedirs(_d, exist_ok=True)
del _d
`);

    // Write file to Pyodide's Emscripten FS
    const FS = (pyodide as any).FS;
    FS.writeFile(pyodidePath, new Uint8Array(content));

    console.log(
      "[mount] Written to Pyodide FS:",
      pyodidePath,
      "bytes:",
      content.byteLength,
    );

    // Resolve the Promise — Python's `await requestMount(...)` returns
    pending.resolve(pyodidePath);

    self.postMessage({
      type: "fileMounted",
      requestId,
      path: vscodePath,
      pyodidePath,
      success: true,
    });
  } catch (err: any) {
    console.error("[mount] FS write failed:", err);
    pending.reject(
      new Error(
        `Failed to write "${pyodidePath}" to Pyodide FS: ${err.message}`,
      ),
    );

    self.postMessage({
      type: "fileMounted",
      requestId,
      path: vscodePath,
      pyodidePath: "",
      success: false,
    });
  }
}

// =====================================================================
// Pyodide init
// =====================================================================
async function initializePyodide(cdnUrl: string) {
  if (isInitialized || isInitializing) return;

  isInitializing = true;
  self.postMessage({ type: "status", status: "initializing" });

  try {
    importScripts(cdnUrl);

    const baseUrl = cdnUrl.substring(0, cdnUrl.lastIndexOf("/") + 1);

    pyodide = await loadPyodide({ indexURL: baseUrl });

    isInitialized = true;
    isInitializing = false;

    await pyodide.loadPackage("micropip");

    const version = pyodide.runPython("import sys; sys.version");

    await setupDisplaySystem();
    setupMountSystem();

    self.postMessage({ type: "initialized", version });
    self.postMessage({ type: "status", status: "ready" });
  } catch (error: any) {
    isInitializing = false;
    self.postMessage({
      type: "error",
      id: "init",
      error: {
        name: "InitializationError",
        message: `Failed to initialize Pyodide: ${error.message}`,
        traceback: error.stack || "",
      },
    });
    self.postMessage({ type: "status", status: "error" });
  }
}

// =====================================================================
// Code execution
// =====================================================================
async function executeCode(id: string, code: string) {
  if (!pyodide) {
    throw new Error("Pyodide not initialized");
  }

  self.postMessage({ type: "status", status: "busy" });

  let stdoutBuffer = "";
  let stderrBuffer = "";

  try {
    pyodide.runPython("_output_capture.start()");

    (pyodide.globals as any).set("__code_to_execute", code);

    // eval_code_async supports top-level await.
    // When Python does `await mount(...)`, it awaits a JS Promise,
    // yielding to the JS event loop. This allows our message handler
    // to receive the mountFileResult and resolve the promise.
    await pyodide.runPythonAsync(`
import sys
import traceback
from pyodide.code import eval_code_async

__exec_result = None
__exec_error = None
__exec_error_name = None
__exec_error_message = None
__exec_traceback = None

try:
    __exec_result = await eval_code_async(__code_to_execute, globals())
except Exception as e:
    __exec_error = e
    __exec_error_name = type(e).__name__
    __exec_error_message = str(e)
    __exec_traceback = ''.join(traceback.format_exception(type(e), e, e.__traceback__))
`);

    const hadError = pyodide.runPython("__exec_error is not None");
    if (hadError) {
      const errorInfo = pyodide.runPython(`{
        'name': __exec_error_name,
        'message': __exec_error_message,
        'traceback': __exec_traceback
      }`);
      const errorData = errorInfo.toJs({ dict_converter: Object.fromEntries });

      pyodide.runPython(
        "del __code_to_execute, __exec_result, __exec_error, __exec_error_name, __exec_error_message, __exec_traceback",
      );

      throw {
        name: errorData.name,
        message: errorData.message,
        traceback: errorData.traceback,
        isPythonError: true,
      };
    }

    let result = pyodide.runPython("__exec_result");

    pyodide.runPython(
      "del __code_to_execute, __exec_result, __exec_error, __exec_error_name, __exec_error_message, __exec_traceback",
    );

    const outputs = pyodide.runPython("_output_capture.stop()");
    stdoutBuffer = outputs.toJs()[0];
    stderrBuffer = outputs.toJs()[1];

    // Auto-display rich representations
    let hasRichRepresentation = false;
    if (result !== undefined && result !== null) {
      try {
        (pyodide.globals as any).set("_temp_result", result);
        const hadRichRepr = pyodide.runPython(`
_has_rich = False
if _temp_result is not None:
    try:
        if hasattr(_temp_result, '_repr_html_') or hasattr(_temp_result, '_repr_png_') or hasattr(_temp_result, '_repr_svg_'):
            display(_temp_result)
            _has_rich = True
    except (AttributeError, ImportError):
        pass
_has_rich
`);
        hasRichRepresentation = hadRichRepr === true;
        pyodide.runPython("del _temp_result");
      } catch (e) {
        // Ignore
      }
    }

    let resultStr = "";
    if (result !== undefined && result !== null && !hasRichRepresentation) {
      resultStr = String(result);
    }

    pyodide.runPython("capture_matplotlib()");

    const displayOutputsRaw = pyodide.runPython("get_display_outputs()");
    let displayOutputs: any[] = [];
    if (displayOutputsRaw && displayOutputsRaw.toJs) {
      displayOutputs = displayOutputsRaw.toJs({
        dict_converter: Object.fromEntries,
      });
    }

    self.postMessage({
      type: "result",
      id,
      result: resultStr,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
      displayOutputs: displayOutputs.length > 0 ? displayOutputs : undefined,
    });

    self.postMessage({ type: "status", status: "idle" });
  } catch (error: any) {
    try {
      const outputs = pyodide!.runPython("_output_capture.stop()");
      stdoutBuffer = outputs.toJs()[0];
      stderrBuffer = outputs.toJs()[1];
    } catch (e) {
      // Ignore
    }

    let errorName = "PythonError";
    let errorMessage = "Unknown error";
    let traceback = "";

    if (error.isPythonError) {
      errorName = error.name || "PythonError";
      errorMessage = error.message || "Unknown error";
      traceback = error.traceback || errorMessage;
    } else {
      const fullError = error.message || String(error);
      traceback = fullError;

      const lines = fullError.split("\n").filter((line: string) => line.trim());
      const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : "";
      const match = lastLine.match(
        /^(\w+(?:Error|Exception|Warning))(?::\s*(.*))?$/,
      );

      if (match) {
        errorName = match[1];
        errorMessage = match[2] || match[1];
      } else {
        errorMessage = fullError;
      }
    }

    self.postMessage({
      type: "error",
      id,
      error: {
        name: errorName,
        message: errorMessage,
        traceback,
      },
    });

    self.postMessage({ type: "status", status: "idle" });
  }
}

// Signal that worker script has loaded
self.postMessage({ type: "status", status: "idle" });
