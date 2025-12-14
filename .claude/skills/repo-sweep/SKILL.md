---
name: repo-sweep
description: Comprehensive pre-production repository audit for preparing repos for public release. Use when the user wants to perform a "final sweep", "production check", "pre-release audit", or prepare a repository to be made public. Audits metadata files across all project types (Fabric mods, Node/npm, Go, Python, etc.) for correct username/organization, checks README links, and identifies leftover development artifacts like planning docs, test scripts, and temporary files. Interactive cleanup with user confirmation.
---

# Repo Sweep

Perform a comprehensive pre-production audit of a repository before making it public. This skill systematically checks metadata files, documentation, and development artifacts to ensure the repo is production-ready.

## Workflow

### 1. Initial Repository Scan

Start by understanding the repository structure and project type(s):

```bash
# Get repository overview
ls -la
find . -type f -name "*.json" -o -name "*.toml" -o -name "*.mod" -o -name "go.mod" | head -20
```

Identify all project types present (can be multiple in monorepos):
- **Fabric Minecraft mod**: Look for `fabric.mod.json`, `gradle.properties`
- **Node/npm**: Look for `package.json`, `package-lock.json`
- **Go**: Look for `go.mod`, `go.sum`
- **Python**: Look for `pyproject.toml`, `setup.py`, `requirements.txt`, `uv.lock`
- **Other**: Check for project-specific metadata files

### 2. Metadata Audit

For each project type found, audit metadata files for correctness. The expected username is **GhostTypes** and organization names should be verified with the user.

#### Fabric Minecraft Mods

Check `fabric.mod.json`:
```bash
cat fabric.mod.json
```

Verify:
- `"authors"`: Should include "GhostTypes"
- `"contact"`: URLs should use correct GitHub username
- `"sources"`: Should point to correct repository URL
- `"homepage"`: Should use correct username/org
- `"issues"`: Should point to correct repository issues

Check `gradle.properties`:
```bash
cat gradle.properties
```

Verify:
- `maven_group`: Should use correct organization (e.g., `io.github.ghosttypes`)
- Any URLs or author fields

#### Node/npm Projects

Check `package.json`:
```bash
cat package.json
```

Verify:
- `"name"`: Should follow correct naming convention with org scope if applicable
- `"author"`: Should be "GhostTypes" or include correct details
- `"repository"`: URL should use correct GitHub username
- `"bugs"`: URL should point to correct repository
- `"homepage"`: Should use correct username/org
- Any other URL fields

**Critical**: Check for `package-lock.json`:
```bash
ls -la package-lock.json
git check-ignore package-lock.json
```

Verify:
- `package-lock.json` exists (required for `npm ci` in CI/CD)
- Not in `.gitignore` (should be committed)
- If missing or ignored, warn user that GitHub Actions will fail with `npm ci`

#### Go Projects

Check `go.mod`:
```bash
cat go.mod
```

Verify:
- `module` path: Should use correct GitHub username (e.g., `github.com/GhostTypes/project-name`)

#### Python Projects

Check `pyproject.toml` or `setup.py`:
```bash
cat pyproject.toml 2>/dev/null || cat setup.py 2>/dev/null
```

Verify:
- `authors` / `author`: Should be "GhostTypes"
- `homepage` / `urls`: Should use correct GitHub username
- `repository`: Should point to correct repo URL

**For UV projects**: Also check the `[tool.uv]` section if present and any `[project.urls]` entries.

### 3. README and Documentation Audit

Check README and other documentation for outdated links:

```bash
cat README.md
find . -name "*.md" -type f | grep -v node_modules | head -10
```

Look for and update:
- GitHub repository links (should use GhostTypes or correct org)
- GitHub badge URLs (shields.io badges, workflow badges, etc.)
- Any references to old usernames or placeholder names
- Documentation links that should point to the correct repo
- Installation instructions that reference the repo

### 4. Development Artifacts Scan

Scan for leftover development files that may not be needed in production:

#### Development Planning/Tracking Files

Look for markdown files typically generated during development:
```bash
find . -type f \( -name "*plan*.md" -o -name "*todo*.md" -o -name "*roadmap*.md" -o -name "*implementation*.md" -o -name "*spec*.md" -o -name "*design*.md" -o -name "*notes*.md" -o -name "*blueprint*.md" -o -name "*tracker*.md" -o -name "*bugs*.md" -o -name "*features*.md" \) | grep -v node_modules | grep -v .git
```

**Action**: Present findings to user and ask what to do with each file:
- Keep in repo (in a `docs/` or `dev-docs/` folder)
- Delete
- Keep for now (user will handle manually)

#### Test Scripts and Temporary Files

Look for standalone test scripts and temporary files in the root:
```bash
# Test scripts
find . -maxdepth 2 -type f \( -name "test*.js" -o -name "test*.py" -o -name "test*.go" -o -name "*_test_*.py" -o -name "debug*.js" -o -name "scratch*.py" \) | grep -v node_modules | grep -v __tests__ | grep -v tests/

# Log files
find . -type f \( -name "*.log" -o -name "*.log.*" \) | grep -v node_modules | head -20

# Temporary files
find . -maxdepth 2 -type f \( -name "*.tmp" -o -name "*.temp" -o -name "temp_*" -o -name "tmp_*" \) | grep -v node_modules
```

**Action**: Present findings to user and recommend deletion unless they serve a specific purpose.

#### Build Artifacts and Cache Files

Check for build artifacts that shouldn't be in the repo:
```bash
# Common build/cache directories (should be in .gitignore)
ls -la | grep -E "(dist|build|out|target|__pycache__|.cache|.next|.nuxt)"

# Check .gitignore exists and is comprehensive
cat .gitignore 2>/dev/null
```

**Action**: Verify these are properly ignored. If not, recommend adding to `.gitignore`.

### 5. GitHub-Specific Files

Check for proper GitHub configuration:

```bash
# Check for GitHub Actions workflows
ls -la .github/workflows/ 2>/dev/null

# Check for issue/PR templates
ls -la .github/ISSUE_TEMPLATE/ 2>/dev/null
ls -la .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null
```

Verify any hardcoded URLs or usernames in these files.

**Workflow Trigger Audit**: Check each workflow file for proper path filtering to prevent unnecessary runs:

```bash
# List all workflows
find .github/workflows -name "*.yml" -o -name "*.yaml"
```

For each workflow, verify triggers are configured appropriately:

**Bad** (triggers on ANY file change):
```yaml
on:
  push:
    branches: [ main ]
  pull_request:
```

**Good** (triggers only on relevant changes):
```yaml
on:
  push:
    branches: [ main ]
    paths:
      - 'src/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/ci.yml'
  pull_request:
    paths:
      - 'src/**'
      - 'package.json'
      - 'package-lock.json'
```

Common path patterns by project type:
- **Node/npm**: `src/**`, `*.js`, `*.ts`, `package.json`, `package-lock.json`
- **Python**: `src/**`, `*.py`, `pyproject.toml`, `requirements.txt`, `uv.lock`
- **Go**: `**/*.go`, `go.mod`, `go.sum`
- **Fabric mods**: `src/**`, `*.java`, `gradle.properties`, `fabric.mod.json`

Files that should NOT trigger CI (add to exclusions or omit from paths):
- `README.md`, `*.md` (unless testing docs)
- `.gitignore`, `.editorconfig`
- `LICENSE`
- `docs/**` (unless you have doc tests)

**Action**: For workflows without path filtering, suggest adding appropriate filters based on project type.

### 6. Generate Summary Report

After completing all checks, provide a structured summary:

1. **Metadata Issues Found**: List all files that need username/org updates
2. **README/Docs Issues**: List documentation files with incorrect links
3. **CI/CD Issues**:
   - Missing or ignored `package-lock.json` for Node projects
   - Workflows without proper path filtering (wasting CI minutes)
4. **Development Artifacts**: Categorized list of files requiring user decision
5. **Recommendations**: Suggested actions for cleanup and optimization

### 7. Interactive Cleanup

For each category of issues found:
- Present findings clearly
- Ask user for preferences (keep/delete/move for dev artifacts)
- Execute approved changes
- Confirm completion

## Important Notes

- **Always ask before deleting**: Never delete files without explicit user confirmation
- **Be thorough but focused**: Check all metadata files but don't get lost in non-metadata code files
- **Respect .gitignore**: Files already gitignored are less urgent to address
- **Support monorepos**: A single repo might have multiple project types
- **Username is case-sensitive**: Use "GhostTypes" exactly (capital G and T)
- **Preserve functionality**: Only suggest removing files that are clearly development artifacts, not files that might be part of the project's functionality

## Common Development Artifact Patterns

Files often created during development that may need cleanup:
- `*-plan.md`, `*-implementation.md`, `*-spec.md`
- `TODO.md`, `ROADMAP.md`, `NOTES.md`
- `BLUEPRINT.md`, `DESIGN_DOC.md`
- `test-*.js/py/go` (in root, not in test directories)
- `debug-*.js/py`, `scratch-*.py`
- `*.log`, `*.log.*` files
- `temp_*.ext`, `tmp_*.ext`
- Files with names like "old_", "backup_", "draft_"
