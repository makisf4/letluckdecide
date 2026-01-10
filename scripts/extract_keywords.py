#!/usr/bin/env python3
"""
Extract keywords from data.js

Reads data.js and extracts all leaf result labels (from pool arrays),
grouped by category (travel/food/fun).
Outputs to keywords.json.
"""

import json
import re
import sys
from pathlib import Path


def normalize_text(text):
    """Normalize text for deduplication (trim whitespace)"""
    return text.strip()


def extract_labels_from_data_js(data_js_path):
    """
    Extract all labels from pool arrays in data.js, grouped by category.
    Uses regex to find pool arrays and labels, tracking category context.
    """
    with open(data_js_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Initialize category buckets
    categories = {
        'travel': set(),
        'food': set(),
        'fun': set()
    }
    
    # Split content by category boundaries
    # Pattern: travel: { ... }, food: { ... }, fun: { ... }
    category_pattern = re.compile(r'\b(travel|food|fun)\s*:\s*\{')
    label_pattern = re.compile(r'label\s*:\s*"([^"]+)"')
    
    # Find all category starts
    category_matches = list(category_pattern.finditer(content))
    
    for i, match in enumerate(category_matches):
        category = match.group(1)
        start_pos = match.end() - 1  # Position after the opening brace
        
        # Find the end of this category (matching closing brace)
        # We need to find the matching } that closes this category object
        brace_count = 1
        pos = start_pos + 1
        end_pos = len(content)
        
        if i + 1 < len(category_matches):
            # Next category starts here, so this category ends before it
            end_pos = category_matches[i + 1].start()
        else:
            # Last category, find the matching closing brace
            while pos < len(content) and brace_count > 0:
                if content[pos] == '{':
                    brace_count += 1
                elif content[pos] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_pos = pos
                        break
                pos += 1
        
        # Extract the category section
        category_section = content[start_pos:end_pos]
        
        # Find all pool arrays in this section
        # Pattern: pool: [ ... ]
        pool_pattern = re.compile(r'pool\s*:\s*\[([^\]]*(?:\[[^\]]*\][^\]]*)*)\]', re.DOTALL)
        
        # Actually, the above won't work for nested structures. Let's use a simpler approach:
        # Find "pool: [" and then extract until matching "]"
        pool_start_pattern = re.compile(r'pool\s*:\s*\[')
        
        for pool_match in pool_start_pattern.finditer(category_section):
            pool_start = pool_match.end() - 1  # Position of the [
            bracket_count = 1
            pos = pool_start + 1
            pool_end = len(category_section)
            
            while pos < len(category_section) and bracket_count > 0:
                if category_section[pos] == '[':
                    bracket_count += 1
                elif category_section[pos] == ']':
                    bracket_count -= 1
                    if bracket_count == 0:
                        pool_end = pos + 1
                        break
                pos += 1
            
            # Extract pool content
            pool_content = category_section[pool_start:pool_end]
            
            # Extract all labels from this pool
            for label_match in label_pattern.finditer(pool_content):
                label = label_match.group(1)
                categories[category].add(normalize_text(label))
    
    # Convert sets to sorted lists
    result = {}
    for category in ['travel', 'food', 'fun']:
        result[category] = sorted(list(categories[category]))
    
    return result


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    data_js_path = project_root / 'data.js'
    keywords_json_path = script_dir / 'keywords.json'
    
    if not data_js_path.exists():
        print(f"Error: {data_js_path} not found", file=sys.stderr)
        return 1
    
    print(f"Reading {data_js_path}...")
    
    try:
        keywords = extract_labels_from_data_js(data_js_path)
    except Exception as e:
        print(f"Error extracting keywords: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    
    # Write output
    with open(keywords_json_path, 'w', encoding='utf-8') as f:
        json.dump(keywords, f, ensure_ascii=False, indent=2)
    
    # Print summary
    print(f"\nExtracted keywords:")
    for category in ['travel', 'food', 'fun']:
        count = len(keywords[category])
        print(f"  {category}: {count} keywords")
    
    print(f"\nOutput written to: {keywords_json_path}")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
