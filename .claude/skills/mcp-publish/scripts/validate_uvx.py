#!/usr/bin/env python3
"""Validates a Python MCP server for PyPI/UVX publishing."""

import sys
import re
import subprocess
import shutil
from pathlib import Path

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        tomllib = None


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
        "uvx": False,
        "pip_install": False,
        "claude_desktop": False,
        "claude_code": False,
    }
    
    # Check for uvx command
    uvx_pattern = re.compile(r'uvx\s+' + re.escape(package_name))
    results["uvx"] = bool(uvx_pattern.search(content))
    
    # Check for pip install
    pip_pattern = re.compile(r'pip\s+install\s+' + re.escape(package_name))
    results["pip_install"] = bool(pip_pattern.search(content))
    
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

    print("=== UVX/PyPI Publishing Validation ===")
    print(f"Project: {project_path}")
    print()

    pyproject_path = project_path / "pyproject.toml"
    if not pyproject_path.exists():
        error("pyproject.toml not found")
        print()
        print(f"Result: {errors} error(s), {warnings} warning(s)")
        sys.exit(1)

    ok("pyproject.toml found")

    if tomllib is None:
        error("tomllib/tomli not available - install tomli for Python <3.11")
        sys.exit(1)

    with open(pyproject_path, "rb") as f:
        data = tomllib.load(f)

    project = data.get("project", {})
    build_system = data.get("build-system", {})

    name = project.get("name", "")
    version = project.get("version", "")
    description = project.get("description", "")
    readme = project.get("readme", "")
    license_field = project.get("license", "")
    requires_python = project.get("requires-python", "")
    build_backend = build_system.get("build-backend", "")
    scripts = project.get("scripts", {})
    urls = project.get("urls", {})

    # Validate name
    if not name:
        error("Missing 'name' in [project]")
    else:
        if "mcp" in name:
            ok(f"Package name: {name}")
        else:
            warn(f"Package name '{name}' does not contain 'mcp' - consider mcp-server-* naming")

    # Validate version
    if not version:
        error("Missing 'version' in [project]")
    else:
        if re.match(r"^\d+\.\d+\.\d+", version):
            ok(f"Version: {version}")
        else:
            warn(f"Version '{version}' may not be valid semver")

    # Validate description
    if not description:
        warn("Missing 'description' in [project]")
    else:
        ok("Description present")

    # Validate readme
    if not readme:
        warn("No 'readme' specified in [project]")
    else:
        readme_path = project_path / readme
        if readme_path.exists():
            ok(f"README: {readme}")
        else:
            error(f"README '{readme}' specified but not found")

    # Check README file exists
    if (project_path / "README.md").exists():
        ok("README.md found")
    elif (project_path / "README.rst").exists():
        ok("README.rst found")
    else:
        error("No README file found")

    # Validate license
    if not license_field:
        warn("No 'license' in [project]")
    else:
        ok(f"License: {license_field}")

    # Check LICENSE file
    license_files = ["LICENSE", "LICENSE.txt", "LICENSE.md"]
    if any((project_path / f).exists() for f in license_files):
        ok("LICENSE file found")
    else:
        warn("No LICENSE file found")

    # Validate requires-python
    if not requires_python:
        warn("No 'requires-python' in [project]")
    else:
        ok(f"Requires Python: {requires_python}")

    # Validate build backend
    if not build_backend:
        error("Missing 'build-backend' in [build-system]")
    else:
        ok(f"Build backend: {build_backend}")

    # Validate scripts (entry points)
    if not scripts:
        error("No [project.scripts] defined - required for uvx execution")
    else:
        script_name = list(scripts.keys())[0]
        ok(f"Entry point: {script_name}")

    # Check package structure
    pkg_name = name.replace("-", "_")
    src_layout = project_path / "src"
    flat_layout = project_path / pkg_name

    if src_layout.exists():
        ok("Using src layout")
        pkg_dir = src_layout
    elif flat_layout.exists():
        ok(f"Using flat layout: {pkg_name}/")
        pkg_dir = flat_layout
    else:
        warn("Package directory not found - check structure")
        pkg_dir = None

    # Check for __init__.py
    if pkg_dir:
        init_files = list(pkg_dir.rglob("__init__.py"))
        if init_files:
            ok("__init__.py found")
        else:
            warn("No __init__.py found - may cause import issues")

    # Check .gitignore
    gitignore_path = project_path / ".gitignore"
    if gitignore_path.exists():
        gitignore = gitignore_path.read_text()
        if any(p in gitignore for p in ["venv", ".venv", "__pycache__"]):
            ok(".gitignore excludes common Python artifacts")
        else:
            warn(".gitignore may not exclude venv/__pycache__")
        if any(p in gitignore for p in ["dist", "build", ".egg"]):
            ok(".gitignore excludes build artifacts")
        else:
            warn(".gitignore does not exclude dist/build directories")
    else:
        warn("No .gitignore file")

    # Check for dist directory
    if (project_path / "dist").exists():
        warn("dist/ directory exists - consider cleaning before build")

    # Repository URL validation
    git_remote = get_git_remote(project_path)
    if git_remote:
        ok(f"Git remote: {git_remote}")
        
        # Get repo URL from pyproject.toml urls
        pyproject_repo_url = urls.get("Repository") or urls.get("repository") or urls.get("Homepage") or urls.get("homepage")
        
        if pyproject_repo_url:
            normalized_git = normalize_repo_url(git_remote)
            normalized_pyproject = normalize_repo_url(pyproject_repo_url)
            
            if normalized_git == normalized_pyproject:
                ok("Repository URL matches git remote")
            else:
                warn(f"Repository URL mismatch - pyproject.toml: {pyproject_repo_url}, git remote: {git_remote}")
                info("CONFIRM: Which repository URL is correct?")
        else:
            warn("No repository URL in [project.urls]")
            info(f"SUGGEST: Add [project.urls] with Repository = \"{git_remote}\"")
    else:
        warn("Could not determine git remote URL")

    # README installation instructions check
    if name and (project_path / "README.md").exists():
        install_checks = check_readme_installation(project_path, name)
        missing = []
        
        if install_checks.get("uvx"):
            ok(f"README has uvx usage: uvx {name}")
        else:
            missing.append(f"uvx {name}")
        
        if install_checks.get("pip_install"):
            ok(f"README has pip install: pip install {name}")
        else:
            missing.append(f"pip install {name}")
        
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
    for ext in ["*.py", "*.toml"]:
        for file in project_path.rglob(ext):
            if any(p in str(file) for p in ["venv", ".venv", "__pycache__"]):
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

    # Check if build tools available
    try:
        import build
        ok("build package available")
    except ImportError:
        warn("build package not installed - run: pip install build")

    if shutil.which("twine"):
        ok("twine available")
    else:
        warn("twine not installed - run: pip install twine")

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
