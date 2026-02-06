# Testing the Pyodide Jupyter Kernel Extension

## Method 1: Test on vscode.dev (Recommended)

1. **Build the extension:**
   ```bash
   cd /workspace/canvas/pyodide-jupyter-kernel
   npm run package
   ```

2. **Package as VSIX:**
   ```bash
   npm install -g @vscode/vsce
   vsce package
   ```

3. **Install on vscode.dev:**
   - Go to https://vscode.dev
   - Press `Cmd/Ctrl+Shift+P`
   - Type "Install from VSIX"
   - Select the generated `.vsix` file

4. **Test the extension:**
   - Create or open a `.ipynb` file
   - Select "Pyodide (Python in Browser)" from kernel picker
   - Open the side panel (click the extension icon)
   - Run Python cells

## Method 2: Use VSCode Desktop with Web Extension

1. **Open in VSCode Desktop:**
   ```bash
   code /workspace/canvas/pyodide-jupyter-kernel
   ```

2. **Run Extension (F5):**
   - Press `F5` to start debugging
   - Select "VS Code Extension Development (Web Extension Host)"
   - This will open a new VSCode window with your extension loaded

3. **Test:**
   - Create a new `.ipynb` file
   - Select "Pyodide (Python in Browser)" kernel
   - Execute cells

## Method 3: Fix @vscode/test-web (If you want to use CLI)

The error you're seeing is due to an outdated `@vscode/test-web` version.

### Fix Option A: Upgrade dependencies

```bash
cd /workspace/canvas/pyodide-jupyter-kernel
npm install --save-dev @vscode/test-web@^0.0.60
```

### Fix Option B: Use npx with latest version

```bash
npx @vscode/test-web@latest --browserType=chromium --extensionDevelopmentPath=. .
```

### Fix Option C: Downgrade Node.js

If using Node.js 20+, downgrade to Node.js 18 LTS:
```bash
nvm install 18
nvm use 18
```

## Method 4: Local Web Server Testing

1. **Install and run:**
   ```bash
   npm install -g @vscode/test-web
   vscode-test-web --browserType=chromium --extensionDevelopmentPath=. .
   ```

2. **Access in browser:**
   - Open the URL shown in terminal (usually http://localhost:3000)
   - Your extension will be pre-loaded

## Quick Test Script

Create a test notebook to verify functionality:

### test.ipynb

```json
{
  "cells": [
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "print('Hello from Pyodide!')",
        "x = 42",
        "x"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "import micropip",
        "await micropip.install('numpy')",
        "import numpy as np",
        "np.array([1, 2, 3])"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# Test mount function",
        "# First create a test file in workspace",
        "with open('/test-output.txt', 'w') as f:",
        "    f.write('Test file created by Pyodide')"
      ]
    }
  ],
  "metadata": {
    "kernelspec": {
      "display_name": "Python 3",
      "language": "python",
      "name": "python3"
    },
    "language_info": {
      "name": "python",
      "version": "3.11.0"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 4
}
```

## Verification Checklist

- [ ] Extension loads without errors
- [ ] Side panel shows "Pyodide Kernel"
- [ ] Can select "Pyodide (Python in Browser)" kernel
- [ ] Status shows "Idle" → "Initializing" → "Ready"
- [ ] Can execute simple Python code
- [ ] Can install packages with micropip
- [ ] Matplotlib figures render as images
- [ ] Pandas DataFrames render as HTML tables
- [ ] Mount function loads files from workspace
- [ ] Mounted files appear in side panel

## Troubleshooting

### Extension doesn't appear
- Ensure you ran `npm run compile` or `npm run package`
- Check `dist/` folder exists with `.js` files
- Verify `package.json` has correct `browser` field

### Pyodide fails to load
- Check browser console for errors
- Verify CDN is accessible (https://cdn.jsdelivr.net/pyodide/)
- Check Content Security Policy allows loading from CDN

### Files won't mount
- Ensure file exists in workspace
- Try relative path instead of absolute
- Check browser console for errors
- Verify workspace folder is open

### Common Errors

**"No workspace folder open"**
- Open a folder in VSCode before testing
- The extension needs a workspace to mount files from

**"Pyodide not initialized"**
- Wait for initialization to complete (4-5 seconds)
- Check side panel shows "Ready" status
- Try executing a simple cell first

## Debug Mode

Enable debug logging in browser console:
1. Open DevTools (F12)
2. Go to Console tab
3. Filter for "Pyodide" or "mount"
4. Look for error messages

## Performance Notes

- First load: 4-5 seconds (Pyodide initialization)
- Subsequent executions: <100ms
- Package installation: Depends on package size
- File mounting: Near-instant for small files
