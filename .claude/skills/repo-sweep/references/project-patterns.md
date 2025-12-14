# Project Type Reference

This reference provides detailed patterns for auditing metadata files across different project types.

## Fabric Minecraft Mods

### fabric.mod.json

Expected fields to audit:
```json
{
  "id": "mod-id",
  "name": "Mod Name",
  "version": "1.0.0",
  "authors": ["GhostTypes"],  // ← Check this
  "contact": {
    "homepage": "https://github.com/GhostTypes/repo-name",  // ← Check this
    "sources": "https://github.com/GhostTypes/repo-name",   // ← Check this
    "issues": "https://github.com/GhostTypes/repo-name/issues"  // ← Check this
  }
}
```

Common mistakes:
- Old username in authors array
- Placeholder URLs like `https://github.com/example/repo`
- Organization URLs when should be personal or vice versa

### gradle.properties

Expected patterns:
```properties
# Maven group
maven_group = io.github.ghosttypes  # ← Check this

# Mod info
mod_id = mod-name
mod_version = 1.0.0
mod_name = Mod Name

# URLs (if present)
mod_url = https://github.com/GhostTypes/repo-name  # ← Check this
```

Common mistakes:
- Generic maven group like `com.example`
- Mismatched username in URLs

## Node/npm Projects

### package.json

Expected fields to audit:
```json
{
  "name": "@ghosttypes/package-name",  // ← Check scope if used
  "version": "1.0.0",
  "description": "Package description",
  "author": "GhostTypes",  // ← Check this
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/GhostTypes/repo-name.git"  // ← Check this
  },
  "bugs": {
    "url": "https://github.com/GhostTypes/repo-name/issues"  // ← Check this
  },
  "homepage": "https://github.com/GhostTypes/repo-name#readme"  // ← Check this
}
```

Common mistakes:
- Missing scope or wrong scope
- Author object format vs string (either is valid, but check username)
- HTTP vs HTTPS URLs
- Missing `.git` suffix in repository URL
- **Missing or ignored `package-lock.json`** (breaks `npm ci` in GitHub Actions)

Alternative author formats:
```json
"author": {
  "name": "GhostTypes",  // ← Check this
  "email": "email@example.com",
  "url": "https://github.com/GhostTypes"  // ← Check this
}
```

### package-lock.json Requirements

**Critical for CI/CD:**

If your GitHub Actions workflow uses `npm ci` (which it should for faster, reproducible builds):
```yaml
- run: npm ci
```

Then `package-lock.json` MUST:
1. ✅ Exist in the repository
2. ✅ Be committed to Git
3. ✅ NOT be in `.gitignore`
4. ✅ Be in sync with `package.json`

**Check commands:**
```bash
# Does it exist?
ls -la package-lock.json

# Is it ignored?
git check-ignore package-lock.json
# (Should return nothing if properly committed)

# Is it committed?
git ls-files package-lock.json
# (Should show the file if committed)
```

**Why this matters:**
- `npm ci` requires `package-lock.json` (unlike `npm install`)
- GitHub Actions will fail without it
- Ensures reproducible builds across environments

## Go Projects

### go.mod

Expected format:
```go
module github.com/GhostTypes/repo-name  // ← Check this

go 1.21

require (
    // dependencies
)
```

Common mistakes:
- Wrong username in module path
- Lowercase username (Go module paths are case-sensitive)
- Using organization name when should be personal or vice versa

## Python Projects

### pyproject.toml

Expected fields to audit:
```toml
[project]
name = "package-name"
version = "1.0.0"
description = "Package description"
authors = [
    { name = "GhostTypes", email = "email@example.com" }  # ← Check this
]

[project.urls]
Homepage = "https://github.com/GhostTypes/repo-name"  # ← Check this
Repository = "https://github.com/GhostTypes/repo-name"  # ← Check this
Issues = "https://github.com/GhostTypes/repo-name/issues"  # ← Check this
```

Common mistakes:
- Old username in authors
- Missing or incorrect URLs
- Using old `setup.py` format when `pyproject.toml` exists

### setup.py (legacy)

Expected format:
```python
from setuptools import setup

setup(
    name='package-name',
    version='1.0.0',
    author='GhostTypes',  # ← Check this
    author_email='email@example.com',
    url='https://github.com/GhostTypes/repo-name',  # ← Check this
    # ...
)
```

### UV Projects

UV is a modern Python package manager. Projects using UV typically have:

1. **pyproject.toml** with optional UV-specific configuration:
```toml
[project]
name = "package-name"
version = "1.0.0"
authors = [
    { name = "GhostTypes", email = "email@example.com" }  # ← Check this
]

[project.urls]
Homepage = "https://github.com/GhostTypes/repo-name"  # ← Check this
Repository = "https://github.com/GhostTypes/repo-name.git"  # ← Check this

[tool.uv]
# UV-specific settings (if present)
dev-dependencies = [
    # ...
]

[tool.uv.sources]
# Optional: custom package sources
# Check for any hardcoded GitHub URLs here
```

2. **uv.lock** - Lockfile (similar to package-lock.json)
   - This is auto-generated, no need to audit
   - Should be committed to repo

3. **.python-version** - Python version specification
   - Check if present and appropriate for the project

Common UV project patterns:
- Uses `pyproject.toml` exclusively (no setup.py)
- May have `.python-version` file
- `uv.lock` should be committed (unlike older virtual environments)
- Development dependencies in `[tool.uv.dev-dependencies]` or `[project.optional-dependencies]`

**Note**: UV projects follow the same `[project]` and `[project.urls]` format as standard Python projects, so the same username/URL checks apply.

## README Patterns

### Common Badge Patterns

GitHub Actions badge:
```markdown
![CI](https://github.com/GhostTypes/repo-name/workflows/CI/badge.svg)
       ^^^^^^^^^^^^^^^^^^^^^^^^  ← Check username
```

Shields.io badges:
```markdown
![GitHub](https://img.shields.io/github/license/GhostTypes/repo-name)
                                                  ^^^^^^^^^^^^^^^^  ← Check username

![npm](https://img.shields.io/npm/v/@ghosttypes/package-name)
                                      ^^^^^^^^^^^  ← Check scope
```

### Installation Instructions

npm:
```markdown
npm install @ghosttypes/package-name
            ^^^^^^^^^^^  ← Check scope
```

Go:
```markdown
go get github.com/GhostTypes/repo-name
       ^^^^^^^^^^^^^^^^^^^^^^^^^^  ← Check username and repo
```

Python/UV:
```markdown
# Using UV
uv add package-name
uv add git+https://github.com/GhostTypes/repo-name
       ^^^^^^^^^^^^^^^^^^^^^^^^^^  ← Check username and repo

# Using pip
pip install package-name
pip install git+https://github.com/GhostTypes/repo-name.git
                ^^^^^^^^^^^^^^^^^^^^^^^^^^  ← Check username and repo
```

Fabric:
```markdown
Download from [GitHub Releases](https://github.com/GhostTypes/repo-name/releases)
                                         ^^^^^^^^^^^^^^^^^^^^^^^^  ← Check username
```

### Repository Links

Common link patterns to check:
- `[GitHub](https://github.com/GhostTypes/repo-name)`
- `[Issues](https://github.com/GhostTypes/repo-name/issues)`
- `[Releases](https://github.com/GhostTypes/repo-name/releases)`
- Clone URLs: `git clone https://github.com/GhostTypes/repo-name.git`

## GitHub Actions Workflows

### Workflow Files (.github/workflows/*.yml)

Check for hardcoded repository references:
```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      # Check any custom steps with hardcoded URLs
      - name: Upload to Release
        uses: actions/upload-release-asset@v1
        with:
          upload_url: https://github.com/GhostTypes/repo-name/...  # ← Check this
```

Common issues:
- Hardcoded repository URLs in custom steps
- Organization-specific secrets that need updating
- Badge status URLs in README that reference the workflow

### Workflow Trigger Optimization

Workflows without proper path filtering waste CI minutes and clutter the Actions tab.

#### Inefficient Triggers (triggers on everything)

```yaml
on:
  push:
    branches: [ main ]
  pull_request:
```

**Problem**: Runs on README changes, config file updates, etc.

#### Optimized Triggers by Project Type

**Node/npm Projects:**
```yaml
on:
  push:
    branches: [ main ]
    paths:
      - 'src/**'
      - 'lib/**'
      - '*.js'
      - '*.ts'
      - 'package.json'
      - 'package-lock.json'  # ← Important for CI
      - 'tsconfig.json'
      - '.github/workflows/ci.yml'  # Re-run if workflow changes
  pull_request:
    paths:
      - 'src/**'
      - 'lib/**'
      - '*.js'
      - '*.ts'
      - 'package.json'
      - 'package-lock.json'
      - 'tsconfig.json'
```

**Python Projects:**
```yaml
on:
  push:
    branches: [ main ]
    paths:
      - 'src/**'
      - '**/*.py'
      - 'pyproject.toml'
      - 'requirements.txt'
      - 'uv.lock'  # If using UV
      - '.github/workflows/ci.yml'
  pull_request:
    paths:
      - 'src/**'
      - '**/*.py'
      - 'pyproject.toml'
      - 'requirements.txt'
      - 'uv.lock'
```

**Go Projects:**
```yaml
on:
  push:
    branches: [ main ]
    paths:
      - '**/*.go'
      - 'go.mod'
      - 'go.sum'
      - '.github/workflows/ci.yml'
  pull_request:
    paths:
      - '**/*.go'
      - 'go.mod'
      - 'go.sum'
```

**Fabric Minecraft Mods:**
```yaml
on:
  push:
    branches: [ main ]
    paths:
      - 'src/**/*.java'
      - 'src/main/resources/**'
      - 'gradle.properties'
      - 'fabric.mod.json'
      - 'build.gradle'
      - '.github/workflows/build.yml'
  pull_request:
    paths:
      - 'src/**/*.java'
      - 'src/main/resources/**'
      - 'gradle.properties'
      - 'fabric.mod.json'
      - 'build.gradle'
```

#### Files That Should NOT Trigger CI

Exclude these from path filters (or use `paths-ignore`):
```yaml
on:
  push:
    branches: [ main ]
    paths-ignore:
      - '**.md'           # Documentation
      - 'docs/**'         # Documentation directory
      - '.gitignore'
      - '.editorconfig'
      - 'LICENSE'
      - '.vscode/**'
      - '.idea/**'
```

Alternatively, be explicit with `paths:` and omit these files.

#### Alternative: paths-ignore Pattern

```yaml
on:
  push:
    branches: [ main ]
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - 'LICENSE'
      - '.gitignore'
  pull_request:
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - 'LICENSE'
```

**Note**: Can't combine `paths:` and `paths-ignore:` in the same trigger. Choose one approach.

#### Always Include Workflow File Itself

Best practice: Always include the workflow file in the paths:
```yaml
paths:
  - 'src/**'
  - '.github/workflows/ci.yml'  # ← Triggers when workflow is updated
```

This ensures workflow changes are tested.

### Common Workflow Patterns by Purpose

**Build/Test CI:**
- Should trigger on source code changes
- Should trigger on dependency file changes
- Should NOT trigger on documentation

**Release/Deploy:**
- Usually manual (`workflow_dispatch`) or tag-based (`push: tags: ['v*']`)
- May not need path filtering

**Documentation Deploy:**
- Should trigger on `docs/**` and `**.md`
- Opposite of build CI

### Package Lock File Requirements

**For Node projects using `npm ci` in workflows:**

If workflow contains:
```yaml
- run: npm ci
```

Then `package-lock.json` MUST:
1. Exist in the repository
2. Be committed (not in `.gitignore`)
3. Be up to date with `package.json`

**Common failure**:
```
npm ERR! code ENOENT
npm ERR! syscall open
npm ERR! path /home/runner/work/repo/package-lock.json
npm ERR! errno -2
npm ERR! enoent ENOENT: no such file, open 'package-lock.json'
```

**Solution**: Ensure `package-lock.json` is committed and not ignored.

## Organization vs Personal Account

When to use organization:
- Team projects
- Project series under a brand
- Meteor Client addons (if under an organization)

When to use personal (GhostTypes):
- Individual projects
- Learning/experimental repos
- Personal tools

**Always verify with user** which is correct for the specific repository.
