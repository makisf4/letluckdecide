#!/usr/bin/env python3
"""
Build enrich.json from keywords.json

Reads scripts/keywords.json and generates data/enrich/enrich.json
with placeholder enrich data and Wikipedia summaries.
"""

import json
import os
import argparse
from pathlib import Path
import unicodedata
import re
import time
import urllib.parse
import requests


def slugify(text):
    """Convert text to URL-friendly slug (lowercase, spaces->-, remove accents)"""
    # Normalize Unicode (NFD = decomposed form)
    text = unicodedata.normalize('NFD', text)
    # Remove accent marks
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    # Convert to lowercase
    text = text.lower()
    # Replace spaces with hyphens
    text = text.replace(' ', '-')
    # Remove any non-alphanumeric/hyphen characters
    text = re.sub(r'[^a-z0-9\-]', '', text)
    # Remove multiple consecutive hyphens
    text = re.sub(r'-+', '-', text)
    # Remove leading/trailing hyphens
    text = text.strip('-')
    return text


def truncate_summary(text, max_length=300):
    """Truncate text to max_length, ending at sentence boundary if possible"""
    if len(text) <= max_length:
        return text
    
    # Try to find sentence boundary (., !, ?) before max_length
    truncated = text[:max_length]
    # Look for last sentence ending
    sentence_end = max(
        truncated.rfind('. '),
        truncated.rfind('! '),
        truncated.rfind('? ')
    )
    
    if sentence_end > max_length * 0.7:  # Only use if it's reasonably close
        return text[:sentence_end + 1]
    
    # Otherwise truncate at word boundary
    word_end = truncated.rfind(' ')
    if word_end > max_length * 0.7:
        return text[:word_end] + '...'
    
    return text[:max_length] + '...'


def fetch_commons_images(keyword, max_images, type_name, slug, session):
    """
    Fetch image URLs from Wikimedia Commons for a keyword.
    Returns list of attribution objects with hotlinked URLs.
    """
    base_url = "https://commons.wikimedia.org/w/api.php"
    
    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": keyword,
        "gsrnamespace": 6,  # File namespace
        "gsrlimit": 10,
        "prop": "imageinfo",
        "iiprop": "url|extmetadata",
        "iiurlwidth": 1200,
        "format": "json"
    }
    
    try:
        response = session.get(base_url, params=params, timeout=10)
        
        if response.status_code != 200:
            print(f"[ERROR] {keyword}: API request failed (HTTP {response.status_code})")
            return []
        
        data = response.json()
        pages = data.get("query", {}).get("pages", {})
        
        if not pages:
            return []
        
        accepted_images = []
        
        # Iterate through files in order
        for page_id, page_data in pages.items():
            if len(accepted_images) >= max_images:
                break
            
            imageinfo_list = page_data.get("imageinfo", [])
            if not imageinfo_list:
                continue
            
            imageinfo = imageinfo_list[0]
            extmetadata = imageinfo.get("extmetadata", {})
            
            # Check license
            license_short = extmetadata.get("LicenseShortName", {}).get("value", "")
            license_full = extmetadata.get("License", {}).get("value", "")
            license_text = (license_short + " " + license_full).upper()
            
            # Accept only Public domain or CC BY licenses
            if "PUBLIC DOMAIN" not in license_text and "CC BY" not in license_text:
                continue
            
            # Filter out small images
            thumbwidth = imageinfo.get("thumbwidth")
            if thumbwidth and thumbwidth < 800:
                continue
            
            # Extract attribution info
            author = extmetadata.get("Artist", {}).get("value", "") or extmetadata.get("Author", {}).get("value", "")
            credit = extmetadata.get("Credit", {}).get("value", "")
            license_val = license_short or license_full or "Unknown"
            
            # Extract filename from title
            file_title = page_data.get("title", "")
            if not file_title.startswith("File:"):
                continue
            filename = file_title.replace("File:", "")
            if not filename:
                continue
            
            # Build hotlink URL using Special:FilePath
            image_url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(filename)}?width=1200"
            source_url = f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(filename.replace(' ', '_'))}"
            
            # Build attribution object with hotlinked URL
            attribution = {
                "src": image_url,
                "source": source_url,
                "author": author or credit or "Unknown",
                "license": license_val
            }
            
            accepted_images.append(attribution)
        
        return accepted_images
    
    except Exception as e:
        print(f"[ERROR] {keyword}: API error ({str(e)})")
        return []


def fetch_wikipedia_summary(keyword, session):
    """
    Fetch Wikipedia summary for a keyword.
    Returns (title, extract) tuple or None if not found/disambiguation.
    """
    base_url = "https://en.wikipedia.org/api/rest_v1/page/summary/"
    # URL-encode the title
    encoded_title = urllib.parse.quote(keyword.replace(' ', '_'))
    url = base_url + encoded_title
    
    try:
        response = session.get(url, timeout=5)
        
        if response.status_code != 200:
            print(f"[HTTP {response.status_code}] {keyword}")
            return None
        
        data = response.json()
        
        # Skip disambiguation pages
        if data.get('type') == 'disambiguation':
            print(f"[SKIP] {keyword}: disambiguation")
            return None
        
        title = data.get('title', keyword)
        extract = data.get('extract', '').strip()
        
        if not extract:
            return None
        
        return (title, extract)
    
    except (requests.RequestException, KeyError, ValueError) as e:
        return None


def main():
    parser = argparse.ArgumentParser(description='Build enrich.json from keywords.json')
    parser.add_argument('--limit', type=int, help='Process only first N keywords total')
    parser.add_argument('--force', action='store_true', help='Overwrite enrich.json if exists')
    args = parser.parse_args()

    # Paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    keywords_file = script_dir / 'keywords.json'
    enrich_file = project_root / 'data' / 'enrich' / 'enrich.json'
    assets_base = project_root / 'assets' / 'enrich'

    # Read keywords
    if not keywords_file.exists():
        print(f"Error: {keywords_file} not found")
        return 1

    with open(keywords_file, 'r', encoding='utf-8') as f:
        keywords_data = json.load(f)

    # Ensure output directories exist
    enrich_file.parent.mkdir(parents=True, exist_ok=True)
    assets_base.mkdir(parents=True, exist_ok=True)

    # Create requests session with proper User-Agent
    session = requests.Session()
    session.headers.update({
        "User-Agent": "letluckdecide/1.0 (https://github.com/makisf4/letluckdecide; contact: you@example.com)",
        "Accept": "application/json"
    })

    # Load existing enrich.json if it exists and --force is not set
    enrich_map = {}
    if enrich_file.exists() and not args.force:
        with open(enrich_file, 'r', encoding='utf-8') as f:
            enrich_map = json.load(f)
        print(f"Loaded existing {enrich_file} ({len(enrich_map)} entries)")
        print("Use --force to overwrite existing summaries\n")

    # Build enrich mapping
    processed_counts = {type_name: 0 for type_name in keywords_data.keys()}
    total_processed = 0

    for type_name, keywords in keywords_data.items():
        for keyword in keywords:
            # Apply limit if specified
            if args.limit is not None and total_processed >= args.limit:
                break

            # Generate slug
            slug = slugify(keyword)

            # Save original entry state for idempotency checks
            original_entry = enrich_map.get(slug, {}) if slug in enrich_map else {}
            original_has_images = bool(original_entry.get('images'))
            original_summary = original_entry.get('summary', '')
            
            # Check if entry exists and should be skipped
            should_skip = False
            if slug in enrich_map and not args.force:
                # Only skip if summary is not TODO and images exist
                if original_summary and original_summary != 'TODO' and original_has_images:
                    print(f"[SKIP] {keyword}: using existing summary and images")
                    processed_counts[type_name] += 1
                    total_processed += 1
                    should_skip = True
                    continue
            
            if not should_skip:
                # Create new entry or reset for --force
                if slug not in enrich_map or args.force:
                    enrich_map[slug] = {
                        "type": type_name,
                        "title": keyword,
                        "summary": "TODO",
                        "images": [],
                        "links": []
                    }
            
            # Fetch Wikipedia summary
            result = fetch_wikipedia_summary(keyword, session)
            
            if result:
                wiki_title, wiki_extract = result
                truncated_summary = truncate_summary(wiki_extract, max_length=300)
                enrich_map[slug]['summary'] = truncated_summary
                # Use Wikipedia title if available (and different from keyword)
                if wiki_title and wiki_title != keyword:
                    enrich_map[slug]['title'] = wiki_title
                print(f"[OK] {keyword}: summary found")
            else:
                print(f"[SKIP] {keyword}: no page / disambiguation")
                # Keep "TODO" as summary
            
            # Fetch Commons images (skip if images already exist and not --force)
            should_fetch_images = args.force or not original_has_images
            
            if should_fetch_images:
                # Set max_images based on type
                max_images = {
                    "travel": 3,
                    "fun": 2,
                    "food": 1
                }.get(type_name, 1)
                
                images = fetch_commons_images(keyword, max_images, type_name, slug, session)
                
                if images:
                    enrich_map[slug]['images'] = images
                    print(f"[OK] {keyword}: images linked {len(images)}")
                else:
                    print(f"[SKIP] {keyword}: no valid images")
                    enrich_map[slug]['images'] = []

            processed_counts[type_name] += 1
            total_processed += 1
            
            # Small delay between requests
            time.sleep(0.2)

        # Break outer loop if limit reached
        if args.limit is not None and total_processed >= args.limit:
            break

    # Write enrich.json
    with open(enrich_file, 'w', encoding='utf-8') as f:
        json.dump(enrich_map, f, ensure_ascii=False, indent=2)

    # Print summary
    print(f"\nProcessed {total_processed} keywords:")
    for type_name, count in processed_counts.items():
        if count > 0:
            print(f"  {type_name}: {count}")
    print(f"\nOutput: {enrich_file}")
    print(f"Assets base: {assets_base}")

    return 0


if __name__ == '__main__':
    exit(main())

