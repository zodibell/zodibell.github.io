import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
import requests
import yaml
from pathlib import Path
from dotenv import load_dotenv

# Load variables from the repository's .env file.
load_dotenv()

# ============================================================
# Configuration
# ============================================================

# The YAML file Jekyll uses.
# This file is generated from your Notion Vocabulary database.
DATA_PATH = Path("_data/vocabulary.yml")

# Notion API configuration.
NOTION_API_URL = "https://api.notion.com/v1/data_sources/{}/query"

# Your Notion API version.
NOTION_VERSION = os.getenv("NOTION_VERSION", "2026-03-11")

# Environment variables expected:
#
#   NOTION_TOKEN
#   NOTION_VOCABULARY_DATA_SOURCE_ID
#
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
NOTION_VOCABULARY_DATA_SOURCE_ID = os.getenv(
    "NOTION_VOCABULARY_DATA_SOURCE_ID"
)


# ============================================================
# Notion helpers
# ============================================================

def get_notion_headers():
    """Build the headers required by the Notion API."""

    if not NOTION_TOKEN:
        raise RuntimeError(
            "NOTION_TOKEN environment variable is not set."
        )

    return {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def get_property(properties, name):
    """
    Safely retrieve a Notion property.

    Returns the property object if it exists, otherwise None.
    """

    prop = properties.get(name)

    if prop is None:
        print(f"⚠️ Notion property not found: {name}")

    return prop


def get_title(properties, name):
    """Extract text from a Notion title property."""

    prop = get_property(properties, name)

    if not prop:
        return ""

    title = prop.get("title", [])

    if not title:
        return ""

    return "".join(
        item.get("plain_text", "")
        for item in title
    ).strip()


def get_rich_text(properties, name):
    """Extract text from a Notion rich_text property."""

    prop = get_property(properties, name)

    if not prop:
        return ""

    rich_text = prop.get("rich_text", [])

    if not rich_text:
        return ""

    return "".join(
        item.get("plain_text", "")
        for item in rich_text
    ).strip()


def get_select(properties, name):
    """Extract the selected value from a Notion select property."""

    prop = get_property(properties, name)

    if not prop:
        return ""

    select = prop.get("select")

    if not select:
        return ""

    return select.get("name", "")


def get_multi_select(properties, name):
    """Extract all selected values from a Notion multi-select property."""

    prop = get_property(properties, name)

    if not prop:
        return []

    values = prop.get("multi_select", [])

    return [
        item.get("name", "")
        for item in values
        if item.get("name")
    ]


def get_url(properties, name):
    """Extract a URL property from Notion."""

    prop = get_property(properties, name)

    if not prop:
        return ""

    return prop.get("url") or ""


# ============================================================
# Fetch vocabulary from Notion
# ============================================================

def fetch_notion_vocabulary():
    """
    Fetch all vocabulary records from the Notion database.

    Notion returns database results in pages, so this function
    continues requesting records until there are no more pages.
    """

    if not NOTION_VOCABULARY_DATA_SOURCE_ID:
        raise RuntimeError(
            "NOTION_VOCABULARY_DATA_SOURCE_ID environment variable "
            "is not set."
        )

    url = NOTION_API_URL.format(NOTION_VOCABULARY_DATA_SOURCE_ID)
    headers = get_notion_headers()

    records = []
    start_cursor = None
    page_number = 1

    print("🔍 Fetching vocabulary from Notion...")
    print(
        f"   Data source: "
        f"{NOTION_VOCABULARY_DATA_SOURCE_ID}"
    )
    print(f"   Notion API version: {NOTION_VERSION}")
    print()

    while True:
        payload = {}

        if start_cursor:
            payload["start_cursor"] = start_cursor

        print(f"📄 Fetching Notion page {page_number}...")

        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
            )
        except requests.RequestException as e:
            print(f"⚠️ Notion request failed: {e}")
            break

        # Debugging information.
        print(
            f"[DEBUG Notion] Page {page_number}: "
            f"{response.status_code}"
        )

        if response.status_code != 200:
            print(
                f"⚠️ Notion API error "
                f"({response.status_code}):"
            )
            print(response.text[:1000])
            break

        try:
            data = response.json()
        except ValueError as e:
            print(
                f"⚠️ Could not parse Notion response as JSON: {e}"
            )
            break

        page_results = data.get("results", [])

        print(
            f"   Records returned: {len(page_results)}"
        )

        records.extend(page_results)

        # Notion tells us whether another page exists.
        if not data.get("has_more"):
            break

        start_cursor = data.get("next_cursor")

        if not start_cursor:
            print(
                "⚠️ Notion reported more records, "
                "but did not provide a next cursor."
            )
            break

        page_number += 1

    print()
    print(
        f"✅ Retrieved {len(records)} vocabulary records "
        f"from Notion."
    )

    return records


# ============================================================
# Convert Notion records to YAML records
# ============================================================

def notion_record_to_yaml(record):
    """
    Convert one Notion vocabulary record into the YAML structure
    expected by the Jekyll vocabulary page.
    """

    properties = record.get("properties", {})

    # --------------------------------------------------------
    # Required/basic vocabulary fields
    # --------------------------------------------------------

    term = get_title(properties, "Term")

    source_preference = get_select(
        properties,
        "Source Preference"
    )

    short_definition = get_rich_text(
        properties,
        "Short Definition"
    )

    part_of_speech = get_select(
        properties,
        "Part of Speech"
    )

    etymology = get_rich_text(
        properties,
        "Etymology"
    )

    source = get_rich_text(
        properties,
        "Source"
    )

    url = get_url(
        properties,
        "URL"
    )

    tags = get_multi_select(
        properties,
        "Tags"
    )

    # --------------------------------------------------------
    # Debugging information
    # --------------------------------------------------------

    if not term:
        print(
            "⚠️ Found a Notion record without a Term. "
            f"Record ID: {record.get('id')}"
        )
        return None

    print(f"✓ Processing: {term}")

    # --------------------------------------------------------
    # Build the YAML record.
    #
    # Keep these field names synchronized with the existing
    # vocabulary.yml structure and your Jekyll templates.
    # --------------------------------------------------------

    entry = {
        "term": term,
        "source_preference": source_preference or "dictionary",
        "short_definition": short_definition,
        "part_of_speech": part_of_speech,
        "etymology": etymology,
        "source": source,
        "url": url,
        "tags": tags,
    }

    return entry


# ============================================================
# Write YAML
# ============================================================

def write_vocabulary_yaml(vocabulary):
    """
    Write the vocabulary records to _data/vocabulary.yml.

    Notion is the source of truth; this YAML file is generated
    for Jekyll.
    """

    print()
    print(f"💾 Writing vocabulary to {DATA_PATH}...")

    try:
        with open(DATA_PATH, "w", encoding="utf-8") as f:
            yaml.dump(
                vocabulary,
                f,
                sort_keys=False,
                allow_unicode=True,
                default_flow_style=False,
            )
    except OSError as e:
        print(
            f"⚠️ Could not write {DATA_PATH}: {e}"
        )
        return False

    print(
        f"✅ Vocabulary file updated successfully."
    )
    print(
        f"   Records written: {len(vocabulary)}"
    )

    return True


# ============================================================
# Main update process
# ============================================================

def update_vocabulary():
    """
    Fetch vocabulary from Notion and regenerate the Jekyll YAML
    data file.
    """

    print("================================")
    print(" Zodi Bell Vocabulary Export")
    print("================================")
    print()

    # --------------------------------------------------------
    # Fetch records from Notion
    # --------------------------------------------------------

    records = fetch_notion_vocabulary()

    if not records:
        print()
        print(
            "⚠️ No vocabulary records were retrieved from Notion."
        )
        print(
            "   The YAML file was NOT changed."
        )
        return

    # --------------------------------------------------------
    # Convert Notion records to YAML
    # --------------------------------------------------------

    vocabulary = []

    print()
    print("🔄 Converting Notion records to YAML...")
    print()

    for record in records:
        entry = notion_record_to_yaml(record)

        if entry:
            vocabulary.append(entry)

    # --------------------------------------------------------
    # Make sure we didn't unexpectedly lose records.
    #
    # This is a safety check so a temporary Notion/API problem
    # doesn't accidentally replace your YAML file with a
    # partially populated file.
    # --------------------------------------------------------

    if not vocabulary:
        print()
        print(
            "⚠️ No valid vocabulary records were created."
        )
        print(
            "   The YAML file was NOT changed."
        )
        return

    if len(vocabulary) != len(records):
        print()
        print(
            f"⚠️ Warning: Notion returned {len(records)} records, "
            f"but only {len(vocabulary)} could be converted."
        )
        print(
            "   The YAML file was NOT changed."
        )
        return

    # --------------------------------------------------------
    # Sort alphabetically by term.
    #
    # This keeps the generated YAML predictable and makes Git
    # diffs much easier to read.
    # --------------------------------------------------------

    vocabulary.sort(
        key=lambda entry: entry["term"].lower()
    )

    # --------------------------------------------------------
    # Write the YAML file
    # --------------------------------------------------------

    write_vocabulary_yaml(vocabulary)

    print()
    print("================================")
    print(" Export complete!")
    print("================================")


# ============================================================
# Run the script
# ============================================================

if __name__ == "__main__":
    update_vocabulary()
