# UVX/PyPI Publishing Guide

Publishing Python MCP servers to PyPI for use with uvx.

## Required pyproject.toml Structure

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "mcp-server-name"
version = "1.0.0"
description = "MCP server for X"
readme = "README.md"
license = "MIT"
requires-python = ">=3.10"
keywords = ["mcp", "mcp-server"]
dependencies = [
    "mcp>=1.0.0",
]

[project.scripts]
mcp-server-name = "mcp_server_name:main"
```

Key requirements:
- `name`: Use `mcp-server-*` naming convention
- `version`: Semver format
- `requires-python`: Minimum Python version
- `[project.scripts]`: Entry point for uvx, maps command to function
- Build backend: hatchling recommended, setuptools also works

## Package Structure

```
mcp-server-name/
├── pyproject.toml
├── README.md
├── LICENSE
└── src/
    └── mcp_server_name/
        ├── __init__.py
        └── server.py
```

Or flat layout:
```
mcp-server-name/
├── pyproject.toml
├── README.md
├── LICENSE
└── mcp_server_name/
    ├── __init__.py
    └── server.py
```

## Entry Point

The `[project.scripts]` entry must point to a callable. Common pattern:

```python
# src/mcp_server_name/__init__.py
from .server import main

__all__ = ["main"]
```

```python
# src/mcp_server_name/server.py
def main():
    # Server startup logic
    ...

if __name__ == "__main__":
    main()
```

## Build Verification

```bash
# Install build tools
pip install build twine

# Build package
python -m build

# Check distribution
twine check dist/*
```

This creates `.tar.gz` and `.whl` files in `dist/`.

## PyPI Authentication

Option 1: API token (recommended)
```bash
# Create token at https://pypi.org/manage/account/token/
# Store in ~/.pypirc or use environment variable
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=pypi-xxxxx
```

Option 2: ~/.pypirc file
```ini
[pypi]
username = __token__
password = pypi-xxxxx
```

## Publishing Commands

Test on TestPyPI first:
```bash
twine upload --repository testpypi dist/*
```

Publish to PyPI:
```bash
twine upload dist/*
```

## Version Management

Update version in pyproject.toml manually or use tools:

```bash
# With hatch
hatch version patch  # 1.0.0 -> 1.0.1
hatch version minor  # 1.0.0 -> 1.1.0
hatch version major  # 1.0.0 -> 2.0.0
```

## Post-Publish Verification

```bash
# Test with uvx
uvx mcp-server-name --help

# Or pip install
pip install mcp-server-name
mcp-server-name --help
```

## Common Issues

**"HTTPError: 400 Bad Request"**: Version already exists, increment version
**"Invalid distribution"**: Missing required metadata, run twine check
**"No module named X"**: Package structure incorrect, check imports
**"Command not found"**: Entry point misconfigured in [project.scripts]

## Repository URL

Add repository URL in pyproject.toml:

```toml
[project.urls]
Repository = "https://github.com/user/repo"
Homepage = "https://github.com/user/repo"
```

Validation script checks this matches the git remote. Fix mismatches before publishing.

## README Installation Section

Include all installation methods in README:

```markdown
## Installation

### Quick Start (uvx)

Run directly without installing:

```bash
uvx mcp-server-name
```

### Pip Installation

Install for repeated use:

```bash
pip install mcp-server-name
mcp-server-name
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "uvx",
      "args": ["mcp-server-name"]
    }
  }
}
```

### Claude Code

Add using the CLI:

```bash
claude mcp add server-name -- uvx mcp-server-name
```
```

Validation script checks README contains all four installation methods.

## Using uv for Publishing

Alternative to twine with uv:
```bash
uv build
uv publish
```

Requires uv 0.5+ and PYPI_TOKEN environment variable.
