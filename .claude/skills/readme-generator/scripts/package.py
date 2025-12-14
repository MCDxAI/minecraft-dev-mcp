#!/usr/bin/env python3
"""
Package the readme-generator skill into a .skill file.

Usage:
    python package.py [output-directory]
"""

import sys
import zipfile
import re
import yaml
from pathlib import Path


def validate_skill(skill_path):
    """Validate the skill before packaging."""
    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        return False, "SKILL.md not found"
    
    content = skill_md.read_text()
    
    # Check frontmatter
    if not content.startswith('---'):
        return False, "No YAML frontmatter found"
    
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format"
    
    frontmatter_text = match.group(1)
    
    try:
        frontmatter = yaml.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return False, "Frontmatter must be a YAML dictionary"
    except yaml.YAMLError as e:
        return False, f"Invalid YAML: {e}"
    
    # Check required fields
    if 'name' not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if 'description' not in frontmatter:
        return False, "Missing 'description' in frontmatter"
    
    # Validate name
    name = frontmatter['name']
    if not re.match(r'^[a-z0-9-]+$', name):
        return False, f"Name '{name}' must be lowercase with hyphens only"
    
    # Validate description
    description = frontmatter['description']
    if '<' in description or '>' in description:
        return False, "Description cannot contain angle brackets"
    
    return True, "Skill is valid"


def package_skill(skill_path, output_dir=None):
    """Package the skill into a .skill file."""
    skill_path = Path(skill_path).resolve()
    
    # Validate first
    print("🔍 Validating skill...")
    valid, message = validate_skill(skill_path)
    if not valid:
        print(f"❌ Validation failed: {message}")
        return None
    print(f"✅ {message}\n")
    
    # Determine output
    skill_name = skill_path.name
    if output_dir:
        output_path = Path(output_dir).resolve()
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        output_path = Path.cwd()
    
    skill_filename = output_path / f"{skill_name}.skill"
    
    # Create zip file
    try:
        with zipfile.ZipFile(skill_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in skill_path.rglob('*'):
                if file_path.is_file():
                    arcname = file_path.relative_to(skill_path.parent)
                    zipf.write(file_path, arcname)
                    print(f"  Added: {arcname}")
        
        print(f"\n✅ Successfully packaged: {skill_filename}")
        return skill_filename
    
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def main():
    skill_path = Path(__file__).parent.parent  # readme-generator directory
    output_dir = sys.argv[1] if len(sys.argv) > 1 else None
    
    print(f"📦 Packaging readme-generator skill\n")
    
    result = package_skill(skill_path, output_dir)
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
