---
name: mcp-publish
description: Guide for publishing MCP servers to NPM (TypeScript/Node.js) or UVX (Python). Use when preparing MCP servers for public distribution, validating package configuration, or walking through the npm publish or uvx/PyPI publishing workflow. Triggers include requests to publish, release, or distribute MCP servers.
---

# MCP Server Publishing

Guides publishing MCP servers to NPM or PyPI/UVX.

## Workflow

1. Detect server type
2. Run validation script
3. Fix issues
4. Publish

## Type Detection

Check project root:
- `package.json` -> TypeScript/Node.js -> See references/npm.md
- `pyproject.toml` -> Python -> See references/uvx.md

If both exist, ask which runtime the server targets.

## Validation

Run before publishing:

**TypeScript/Node.js:**
```bash
python <skill-path>/scripts/validate_npm.py <project-path>
```

**Python:**
```bash
python <skill-path>/scripts/validate_uvx.py <project-path>
```

Replace `<skill-path>` with this skill's location and `<project-path>` with the MCP server directory.

Fix all errors before proceeding to publish.

## Repository URL Validation

After running validation, check that the package manifest matches the git remote:

1. Get the configured git remote: `git remote get-url origin`
2. Compare with repository field in package.json or pyproject.toml
3. If mismatch, confirm with user which is correct before proceeding
4. Update the manifest file if needed

## README Installation Section

Before publishing, verify and update the README installation instructions.

Validation checks for all four installation methods:

**TypeScript/Node.js:**
- npx command: `npx @scope/package-name`
- Global install: `npm install -g @scope/package-name`
- Claude Desktop config (claude_desktop_config.json with mcpServers)
- Claude Code CLI: `claude mcp add`

**Python:**
- uvx command: `uvx package-name`
- Pip install: `pip install package-name`
- Claude Desktop config (claude_desktop_config.json with mcpServers)
- Claude Code CLI: `claude mcp add`

Update README sections automatically if any methods are missing.

## Pre-Publish Checklist

Verify before any publish:

1. Version incremented from last release
2. README.md exists with server description
3. LICENSE file present
4. No secrets in committed files
5. Build artifacts excluded via .gitignore
6. Server runs locally without errors
7. Repository URL in manifest matches git remote
8. README installation instructions are correct
