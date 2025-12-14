#!/usr/bin/env python3
"""
Validate README.md files against Ghost's formatting standards.

Usage:
    python validate_readme.py <path-to-readme.md>
"""

import re
import sys
from pathlib import Path
from typing import List, Tuple


class ReadmeValidator:
    def __init__(self, readme_path: Path):
        self.path = readme_path
        self.content = readme_path.read_text(encoding='utf-8')
        self.errors: List[str] = []
        self.warnings: List[str] = []
        
    def validate(self) -> Tuple[List[str], List[str]]:
        """Run all validation checks."""
        self.check_no_emojis()
        self.check_centered_structure()
        self.check_no_standalone_bullets()
        self.check_shields_badges()
        self.check_code_blocks_not_centered()
        self.check_table_structure()
        
        return self.errors, self.warnings
    
    def check_no_emojis(self):
        """Check for emoji characters."""
        # Common emoji ranges in Unicode
        emoji_pattern = re.compile(
            "["
            "\U0001F600-\U0001F64F"  # emoticons
            "\U0001F300-\U0001F5FF"  # symbols & pictographs
            "\U0001F680-\U0001F6FF"  # transport & map symbols
            "\U0001F1E0-\U0001F1FF"  # flags
            "\U00002702-\U000027B0"  # dingbats
            "\U000024C2-\U0001F251"  # enclosed characters
            "]+",
            flags=re.UNICODE
        )
        
        matches = emoji_pattern.findall(self.content)
        if matches:
            self.errors.append(f"❌ Found {len(matches)} emoji(s): {', '.join(set(matches))}")
        
    def check_centered_structure(self):
        """Check that content uses center tags appropriately."""
        # Check for main title centering
        if not re.search(r'<div align="center">\s*\n\s*#', self.content):
            self.warnings.append("⚠️ Main title should be in a centered div")
        
        # Count centered sections
        center_divs = len(re.findall(r'<div align="center">', self.content))
        if center_divs < 2:
            self.warnings.append(f"⚠️ Only {center_divs} centered section(s) found - most content should be centered")
    
    def check_no_standalone_bullets(self):
        """Check for standalone bullet lists (not in tables)."""
        lines = self.content.split('\n')
        in_table = False
        in_code_block = False
        
        for i, line in enumerate(lines, 1):
            # Track code blocks
            if line.strip().startswith('```'):
                in_code_block = not in_code_block
                continue
            
            if in_code_block:
                continue
            
            # Track tables
            if '|' in line and not in_table:
                in_table = True
            elif in_table and line.strip() and '|' not in line and not line.strip().startswith('</div>'):
                in_table = False
            
            # Check for bullets outside tables
            if not in_table and re.match(r'^\s*[-*]\s+', line):
                self.errors.append(f"❌ Standalone bullet list found at line {i}: {line.strip()[:50]}")
    
    def check_shields_badges(self):
        """Check that badges use shields.io."""
        badge_pattern = r'!\[.*?\]\((https?://[^\)]+)\)'
        badges = re.findall(badge_pattern, self.content)
        
        for badge_url in badges:
            if 'shields.io' not in badge_url and 'githubusercontent.com' not in badge_url:
                self.warnings.append(f"⚠️ Badge not using shields.io: {badge_url}")
            
            # Check for proper style parameter
            if 'shields.io' in badge_url and 'style=flat' not in badge_url:
                self.warnings.append(f"⚠️ Shield badge missing style=flat: {badge_url}")
    
    def check_code_blocks_not_centered(self):
        """Check that standalone code blocks are not in center tags."""
        # Look for code blocks inside center divs
        pattern = r'<div align="center">.*?```.*?```.*?</div>'
        if re.search(pattern, self.content, re.DOTALL):
            # This is tricky - need to check if it's in a table or not
            # For now, just warn
            self.warnings.append("⚠️ Code block might be inside center div - verify it's in a table cell")
    
    def check_table_structure(self):
        """Check for proper table usage."""
        # Count tables
        table_count = len(re.findall(r'\|.*?\|.*?\|', self.content))
        
        if table_count == 0:
            self.errors.append("❌ No tables found - content should be organized in tables")
        
        # Check table headers
        header_pattern = r'\|\s*---\s*\|'
        header_count = len(re.findall(header_pattern, self.content))
        
        if header_count < 2:
            self.warnings.append(f"⚠️ Only {header_count} table header separator(s) found")
    
    def print_results(self):
        """Print validation results."""
        print(f"\n{'='*60}")
        print(f"README Validation: {self.path.name}")
        print(f"{'='*60}\n")
        
        if not self.errors and not self.warnings:
            print("✅ All checks passed! README follows the style guidelines.\n")
            return True
        
        if self.errors:
            print(f"ERRORS ({len(self.errors)}):")
            for error in self.errors:
                print(f"  {error}")
            print()
        
        if self.warnings:
            print(f"WARNINGS ({len(self.warnings)}):")
            for warning in self.warnings:
                print(f"  {warning}")
            print()
        
        return len(self.errors) == 0


def main():
    if len(sys.argv) != 2:
        print("Usage: python validate_readme.py <path-to-readme.md>")
        sys.exit(1)
    
    readme_path = Path(sys.argv[1])
    
    if not readme_path.exists():
        print(f"Error: File not found: {readme_path}")
        sys.exit(1)
    
    validator = ReadmeValidator(readme_path)
    errors, warnings = validator.validate()
    success = validator.print_results()
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
