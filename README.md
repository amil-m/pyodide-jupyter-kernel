# Pyodide Jupyter Kernel

A VSCode extension that enables running Jupyter notebooks with Python in the browser using Pyodide (WebAssembly).

## Usage

### Running Notebooks

1. Open a `.ipynb` (Jupyter notebook) file in VSCode
2. Select "Pyodide (Python in Browser)" from the kernel picker
3. Execute cells - Pyodide will initialize on first execution (takes 4-5 seconds)
4. Variables persist across cells and notebooks (shared state)

### Installing Packages
Use micropip in a code cell to install packages:

```python
import micropip
await micropip.install("numpy")
import numpy as np
print(np.array([1, 2, 3]))
```

### Loading Files with mount()

Use the `mount()` function to load files from your VSCode workspace into Pyodide's virtual filesystem:

```python
# Mount a CSV file from workspace
await mount('data.csv')

# Now you can read it with pandas
# Use the file names shown in sidebar
import pandas as pd
df = pd.read_csv('/data.csv')
display(df)
```

**Examples:**
```python
# Mount file from workspace root
await mount('data.csv')

# Mount from subdirectory
await mount('data/myfile.txt') 

# Mount to specific path in Pyodide
await mount('data/input.csv', '/data/input.csv') 

# Mount and use with various libraries
await mount('config.json')
import json
with open('/config.json') as f:
    config = json.load(f)

# Mount image files
await mount('/workspace/images/photo.jpg')
from PIL import Image
img = Image.open('/photo.jpg')
display(img)
```

**Mounted Files Panel:**
The side panel shows all files you've mounted, displaying both the VSCode path and the Pyodide path for easy reference.

### Monitoring Kernel Status

Open the "Pyodide Kernel" panel from the activity bar to see:
- Current kernel status (Initializing/Ready/Busy/Idle)
- Reset the kernel
- Initialization progress
- Pyodide version


## Development

### Building

```bash
npm install
npm run compile
```

### Testing

Test the extension using VSCode's web extension test framework:

```bash
npm install -g @vscode/test-web
npm run test-web
```

### Building

Compile packages with visx

```bash
vsce package
```

## Credits

Built with:
- [Pyodide](https://pyodide.org/) - Python runtime for WebAssembly
- [VSCode Extension API](https://code.visualstudio.com/api)
