# NPM Publishing Guide

Publishing TypeScript/Node.js MCP servers to NPM.

## Required package.json Fields

```json
{
  "name": "@scope/mcp-server-name",
  "version": "1.0.0",
  "description": "MCP server for X",
  "type": "module",
  "bin": {
    "mcp-server-name": "./dist/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["mcp", "mcp-server"],
  "license": "MIT",
  "engines": {
    "node": ">=18"
  }
}
```

Key requirements:
- `name`: Use `@scope/mcp-server-*` format or `mcp-server-*` for unscoped
- `version`: Semver format, increment for each release
- `type`: Must be `"module"` for ESM
- `bin`: Entry point for npx execution, must point to compiled JS with shebang
- `files`: Include only the dist directory
- `prepublishOnly`: Ensures build runs before publish

## Entry Point Shebang

The compiled entry point (dist/index.js) must have a shebang. Add to source:

```typescript
#!/usr/bin/env node
```

TypeScript must preserve this. Check tsconfig.json:

```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  }
}
```

## Build Verification

Before publishing:

```bash
npm run build
node dist/index.js --help  # or appropriate test
```

## NPM Authentication

First-time setup:
```bash
npm login
```

For scoped packages, ensure scope is linked to your account or org.

## Publishing Commands

Dry run first:
```bash
npm publish --dry-run
```

Actual publish:
```bash
# Unscoped or private scope
npm publish

# Public scoped package
npm publish --access public
```

## Version Management

Use npm version commands:
```bash
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0
```

This updates package.json and creates a git tag.

## Post-Publish Verification

```bash
npx @scope/mcp-server-name --help
```

Or for unscoped:
```bash
npx mcp-server-name --help
```

## Common Issues

**"ERR! 403 Forbidden"**: Package name taken or not authenticated
**"ERR! 404 Not Found"**: Scope doesn't exist, create org first
**"bin not found"**: Missing files array or wrong bin path
**"SyntaxError: Cannot use import"**: Missing `"type": "module"`

## Repository Field

Add repository URL to package.json:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/user/repo.git"
  }
}
```

Or shorthand:
```json
{
  "repository": "github:user/repo"
}
```

Validation script checks this matches the git remote. Fix mismatches before publishing.

## README Installation Section

Include all installation methods in README:

```markdown
## Installation

### Quick Start (npx)

Run directly without installing:

```bash
npx @scope/mcp-server-name
```

### Global Installation

Install globally for repeated use:

```bash
npm install -g @scope/mcp-server-name
mcp-server-name
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@scope/mcp-server-name"]
    }
  }
}
```

### Claude Code

Add using the CLI:

```bash
claude mcp add server-name -- npx -y @scope/mcp-server-name
```
```

Validation script checks README contains all four installation methods.
