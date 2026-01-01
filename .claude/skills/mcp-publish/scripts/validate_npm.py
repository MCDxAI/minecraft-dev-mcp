#!/usr/bin/env python3
"""Validates a TypeScript/Node.js MCP server for NPM publishing."""

import json
import sys
import re
import subprocess
from pathlib import Path


def get_git_remote(project_path):
    """Get the git remote origin URL."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=project_path,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


def normalize_repo_url(url):
    """Normalize git URLs for comparison."""
    if not url:
        return None
    url = url.strip()
    # Convert SSH to HTTPS format for comparison
    if url.startswith("git@github.com:"):
        url = url.replace("git@github.com:", "https://github.com/")
    # Remove .git suffix
    if url.endswith(".git"):
        url = url[:-4]
    # Remove trailing slashes
    url = url.rstrip("/")
    return url.lower()


def check_readme_installation(project_path, package_name):
    """Check README for correct installation instructions."""
    readme_path = project_path / "README.md"
    if not readme_path.exists():
        return {}
    
    content = readme_path.read_text()
    
    results = {
        "npx": False,
        "npm_global": False,
        "claude_desktop": False,
        "claude_code": False,
    }
    
    # Check for npx command
    npx_pattern = re.compile(r'npx\s+' + re.escape(package_name))
    results["npx"] = bool(npx_pattern.search(content))
    
    # Check for npm install -g
    npm_global_pattern = re.compile(r'npm\s+install\s+(-g|--global)\s+' + re.escape(package_name))
    results["npm_global"] = bool(npm_global_pattern.search(content))
    
    # Check for Claude Desktop config (mcpServers JSON block)
    claude_desktop_pattern = re.compile(r'claude_desktop_config\.json|"mcpServers"', re.IGNORECASE)
    results["claude_desktop"] = bool(claude_desktop_pattern.search(content))
    
    # Check for Claude Code CLI command
    claude_code_pattern = re.compile(r'claude\s+mcp\s+add', re.IGNORECASE)
    results["claude_code"] = bool(claude_code_pattern.search(content))
    
    return results


def main():
    project_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    errors = 0
    warnings = 0

    def error(msg):
        nonlocal errors
        print(f"[ERROR] {msg}")
        errors += 1

    def warn(msg):
        nonlocal warnings
        print(f"[WARN] {msg}")
        warnings += 1

    def ok(msg):
        print(f"[OK] {msg}")

    def info(msg):
        print(f"[INFO] {msg}")

    print("=== NPM Publishing Validation ===")
    print(f"Project: {project_path}")
    print()

    package_json_path = project_path / "package.json"
    if not package_json_path.exists():
        error("package.json not found")
        print()
        print(f"Result: {errors} error(s), {warnings} warning(s)")
        sys.exit(1)

    with open(package_json_path) as f:
        pkg = json.load(f)

    name = pkg.get("name", "")
    version = pkg.get("version", "")
    pkg_type = pkg.get("type", "")
    bin_field = pkg.get("bin", {})
    files_field = pkg.get("files", [])
    scripts = pkg.get("scripts", {})
    repository = pkg.get("repository", {})

    # Validate name
    if not name:
        error("Missing 'name' field in package.json")
    else:
        if "mcp" in name or "@" in name:
            ok(f"Package name: {name}")
        else:
            warn(f"Package name '{name}' does not contain 'mcp' - consider mcp-server-* naming")

    # Validate version
    if not version:
        error("Missing 'version' field in package.json")
    else:
        if re.match(r"^\d+\.\d+\.\d+", version):
            ok(f"Version: {version}")
        else:
            warn(f"Version '{version}' may not be valid semver")

    # Validate type
    if pkg_type != "module":
        error("Missing or incorrect 'type' field - must be 'module' for ESM")
    else:
        ok("Type: module (ESM)")

    # Validate bin
    if not bin_field:
        error("Missing 'bin' field - required for npx execution")
    else:
        ok("Bin entry defined")
        bin_path = list(bin_field.values())[0] if isinstance(bin_field, dict) else bin_field
        bin_file = project_path / bin_path
        if bin_file.exists():
            with open(bin_file) as f:
                first_line = f.readline()
            if first_line.startswith("#!"):
                ok("Bin target has shebang")
            else:
                error(f"Bin target '{bin_path}' missing shebang (#!/usr/bin/env node)")
        else:
            warn(f"Bin target '{bin_path}' not found - ensure build creates it")

    # Validate files
    if not files_field:
        warn("No 'files' field - entire package will be published")
    else:
        ok("Files field defined")

    # Check for build script
    if "build" not in scripts:
        error("Missing 'build' script in package.json")
    else:
        ok(f"Build script: {scripts['build']}")

    # Check prepublishOnly
    if "prepublishOnly" not in scripts:
        warn("No 'prepublishOnly' script - build may not run before publish")
    else:
        ok("prepublishOnly script defined")

    # Check for tsconfig.json
    if (project_path / "tsconfig.json").exists():
        ok("tsconfig.json found")
    else:
        warn("tsconfig.json not found - may not be TypeScript project")

    # Check for README
    if (project_path / "README.md").exists():
        ok("README.md found")
    else:
        error("README.md not found")

    # Check for LICENSE
    license_files = ["LICENSE", "LICENSE.txt", "LICENSE.md"]
    if any((project_path / f).exists() for f in license_files):
        ok("LICENSE file found")
    else:
        warn("No LICENSE file found")

    # Check .gitignore
    gitignore_path = project_path / ".gitignore"
    if gitignore_path.exists():
        gitignore = gitignore_path.read_text()
        if "node_modules" in gitignore:
            ok(".gitignore excludes node_modules")
        else:
            warn(".gitignore does not exclude node_modules")
        if "dist" in gitignore:
            ok(".gitignore excludes dist")
        else:
            warn(".gitignore does not exclude dist - may commit build artifacts")
    else:
        warn("No .gitignore file")

    # Check .npmignore or files field
    if (project_path / ".npmignore").exists():
        ok(".npmignore found")
    elif files_field:
        ok("Using 'files' field for publish filtering")
    else:
        warn("No .npmignore or 'files' field - may publish unnecessary files")

    # Repository URL validation
    git_remote = get_git_remote(project_path)
    if git_remote:
        ok(f"Git remote: {git_remote}")
        
        # Get repo URL from package.json
        pkg_repo_url = None
        if isinstance(repository, str):
            pkg_repo_url = repository
        elif isinstance(repository, dict):
            pkg_repo_url = repository.get("url", "")
        
        if pkg_repo_url:
            normalized_git = normalize_repo_url(git_remote)
            normalized_pkg = normalize_repo_url(pkg_repo_url)
            
            if normalized_git == normalized_pkg:
                ok("Repository URL matches git remote")
            else:
                warn(f"Repository URL mismatch - package.json: {pkg_repo_url}, git remote: {git_remote}")
                info("CONFIRM: Which repository URL is correct?")
        else:
            warn("No 'repository' field in package.json")
            info(f"SUGGEST: Add repository field with URL: {git_remote}")
    else:
        warn("Could not determine git remote URL")

    # README installation instructions check
    if name and (project_path / "README.md").exists():
        install_checks = check_readme_installation(project_path, name)
        missing = []
        
        if install_checks.get("npx"):
            ok(f"README has npx usage: npx {name}")
        else:
            missing.append(f"npx {name}")
        
        if install_checks.get("npm_global"):
            ok(f"README has global install: npm install -g {name}")
        else:
            missing.append(f"npm install -g {name}")
        
        if install_checks.get("claude_desktop"):
            ok("README has Claude Desktop configuration")
        else:
            missing.append("Claude Desktop config (claude_desktop_config.json)")
        
        if install_checks.get("claude_code"):
            ok("README has Claude Code CLI command")
        else:
            missing.append("Claude Code CLI (claude mcp add)")
        
        if missing:
            warn("README missing installation instructions:")
            for item in missing:
                info(f"  - {item}")

    # Check for common secrets patterns
    secret_patterns = re.compile(r"sk-|api_key|apikey|secret|password", re.IGNORECASE)
    for ext in ["*.ts", "*.js", "*.json"]:
        for file in project_path.rglob(ext):
            if "node_modules" in str(file):
                continue
            try:
                content = file.read_text()
                if secret_patterns.search(content):
                    warn("Possible secrets found in source files - review before publishing")
                    break
            except Exception:
                pass
        else:
            continue
        break

    print()
    print("=== Validation Complete ===")
    print(f"Errors: {errors}")
    print(f"Warnings: {warnings}")
    print()

    if errors > 0:
        print("Fix errors before publishing.")
        sys.exit(1)
    else:
        if warnings > 0:
            print("Review warnings before publishing.")
        else:
            print("Ready to publish.")
        sys.exit(0)


if __name__ == "__main__":
    main()
