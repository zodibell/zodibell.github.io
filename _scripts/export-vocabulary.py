import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv


# ============================================================
# Zodi Bell Vocabulary — Notion → YAML Export
# ============================================================
#
# PURPOSE
# -------
# Notion is the source of truth for the vocabulary database.
#
# This script:
#
#   1. Fetches vocabulary records from Notion
#   2. Converts Notion properties to the YAML structure used
#      by the Jekyll site
#   3. Validates the converted data
#   4. Writes _data/vocabulary.yml
#
# WORKFLOW
# --------
# Make changes to vocabulary in Notion, then run:
#
#   python _scripts/export-vocabulary.py
#
# The Jekyll site continues to read:
#
#   _data/vocabulary.yml
#
# IMPORTANT
# ---------
# This script will NOT overwrite the YAML file unless the
# Notion data successfully converts into a valid list of
# vocabulary records.
#
# ============================================================


# ------------------------------------------------------------
# Load environment variables
# ------------------------------------------------------------

load_dotenv()


# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------

DATA_PATH = Path("_data/vocabulary.yml")

NOTION_API_URL = "https://api.notion.com/v1/data_sources/{}/query"

NOTION_VERSION = os.getenv(
    "NOTION_VERSION",
    "2026-03-11"
)

NOTION_TOKEN = os.getenv("NOTION_TOKEN")

NOTION_VOCABULARY_DATA_SOURCE_ID = os.getenv(
    "NOTION_VOCABULARY_DATA_SOURCE_ID"
)


# ------------------------------------------------------------
# Validate environment variables before doing anything
# ------------------------------------------------------------

if not NOTION_TOKEN:
    print("❌ ERROR: NOTION_TOKEN is not set in .env")
    sys.exit(1)

if not NOTION_VOCABULARY_DATA_SOURCE_ID:
    print(
        "❌ ERROR: NOTION_VOCABULARY_DATA_SOURCE_ID "
        "is not set in .env"
    )
    sys.exit(1)


# ------------------------------------------------------------
# Notion API headers
# ------------------------------------------------------------

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}


# ============================================================
# Notion property helpers
# ============================================================

def get_title(properties, property_name):
    """
    Return the text from a Notion title property.

    Example:
        Term → "anarcho-syndicalism"
    """

    prop = properties.get(property_name)

    if not prop:
        return None

    title = prop.get("title", [])

    if not title:
        return None

    return "".join(
        item.get("plain_text", "")
        for item in title
    ).strip() or None


def get_rich_text(properties, property_name):
    """
    Return the text from a Notion rich_text property.

    Example:
        Short Definition → "Immortality."
    """

    prop = properties.get(property_name)

    if not prop:
        return None

    rich_text = prop.get("rich_text", [])

    if not rich_text:
        return None

    value = "".join(
        item.get("plain_text", "")
        for item in rich_text
    ).strip()

    return value or None


def get_select(properties, property_name):
    """
    Return the selected value from a Notion select property.

    Example:
        Source → "Wikipedia.org"

    This is important because Source and Part of Speech
    are SELECT properties in the Notion database.
    """

    prop = properties.get(property_name)

    if not prop:
        return None

    select = prop.get("select")

    if not select:
        return None

    return select.get("name") or None


def get_multi_select(properties, property_name):
    """
    Return values from a Notion multi-select property.

    Example:
        Tags → ["nouns", "politics", "Marxism"]
    """

    prop = properties.get(property_name)

    if not prop:
        return []

    values = prop.get("multi_select", [])

    return [
        item.get("name")
        for item in values
        if item.get("name")
    ]


def get_url(properties, property_name):
    """
    Return the value from a Notion URL property.

    Example:
        URL → https://en.wikipedia.org/wiki/...
    """

    prop = properties.get(property_name)

    if not prop:
        return None

    return prop.get("url") or None


# ============================================================
# Convert one Notion page into a vocabulary record
# ============================================================

def convert_page(page):
    """
    Convert a Notion page into the structure expected by
    _data/vocabulary.yml.
    """

    properties = page.get("properties", {})

    record = {
        "term": get_title(properties, "Term"),
        "source_preference": get_select(
            properties,
            "Source Preference"
        ),
        "short_definition": get_rich_text(
            properties,
            "Short Definition"
        ),
        "part_of_speech": get_select(
            properties,
            "Part of Speech"
        ),
        "etymology": get_rich_text(
            properties,
            "Etymology"
        ),
        "source": get_select(
            properties,
            "Source"
        ),
        "url": get_url(
            properties,
            "URL"
        ),
        "tags": get_multi_select(
            properties,
            "Tags"
        ),
    }

    return record


# ============================================================
# Validate a vocabulary record
# ============================================================

def validate_record(record, index):
    """
    Make sure the record contains the fields required by
    the YAML structure.

    Empty optional fields are allowed and are represented
    as null in YAML.

    The term is the one field that must exist.
    """

    term = record.get("term")

    if not term:
        print(
            f"❌ Record {index} is missing its Term."
        )
        return False

    return True


# ============================================================
# Fetch all vocabulary records from Notion
# ============================================================

def fetch_all_pages():
    """
    Retrieve every page from the Notion data source.

    Notion paginates query results, so this function continues
    requesting pages until has_more is false.
    """

    url = NOTION_API_URL.format(
        NOTION_VOCABULARY_DATA_SOURCE_ID
    )

    all_pages = []
    cursor = None
    page_number = 1

    print("🔍 Fetching vocabulary from Notion...")
    print(
        f"   Data source: "
        f"{NOTION_VOCABULARY_DATA_SOURCE_ID}"
    )
    print(
        f"   Notion API version: {NOTION_VERSION}"
    )
    print()

    while True:

        print(
            f"📄 Fetching Notion page {page_number}..."
        )

        payload = {}

        if cursor:
            payload["start_cursor"] = cursor

        response = requests.post(
            url,
            headers=HEADERS,
            json=payload,
            timeout=30,
        )

        print(
            f"[DEBUG Notion] Page {page_number}: "
            f"{response.status_code}"
        )

        if response.status_code != 200:
            print(
                "❌ Notion API request failed:"
            )
            print(response.text)
            sys.exit(1)

        data = response.json()

        pages = data.get("results", [])

        print(
            f"   Records returned: {len(pages)}"
        )

        all_pages.extend(pages)

        if not data.get("has_more"):
            break

        cursor = data.get("next_cursor")

        if not cursor:
            print(
                "❌ Notion indicated that more records "
                "exist, but no next cursor was returned."
            )
            sys.exit(1)

        page_number += 1

    print()
    print(
        f"✅ Retrieved {len(all_pages)} vocabulary "
        f"records from Notion."
    )
    print()

    return all_pages


# ============================================================
# Convert all records
# ============================================================

def convert_pages(pages):
    """
    Convert Notion pages into vocabulary records and
    validate every record before anything is written.
    """

    print("🔄 Converting Notion records to YAML...")
    print()

    records = []

    for index, page in enumerate(pages, start=1):

        record = convert_page(page)

        term = record.get("term") or "(missing term)"

        print(f"✓ Processing: {term}")

        if not validate_record(record, index):
            print()
            print(
                "❌ Export stopped because one or more "
                "records failed validation."
            )
            sys.exit(1)

        records.append(record)

    print()

    # --------------------------------------------------------
    # Sort alphabetically by term
    # --------------------------------------------------------
    #
    # Notion does not guarantee the order in which records
    # are returned. Sorting here keeps vocabulary.yml stable
    # and prevents unnecessary Git diffs.
    #
    records.sort(
        key=lambda record: record["term"].lower()
    )

    return records


# ============================================================
# YAML dumper
# ============================================================

class VocabularyDumper(yaml.SafeDumper):
    """
    Custom YAML dumper.

    PyYAML normally formats nested lists like this:

    tags:
    - nouns
    - politics

    The existing vocabulary.yml uses this style instead:

    tags:
      - nouns
      - politics

    This custom dumper preserves that indentation style.
    """

    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(
            flow,
            indentless=False
        )


# ============================================================
# Create YAML text
# ============================================================

def create_yaml(records):
    """
    Convert vocabulary records into the YAML text used by
    the Jekyll site.

    width=1000 prevents PyYAML from wrapping long
    definitions onto multiple lines.
    """

    return yaml.dump(
        records,
        Dumper=VocabularyDumper,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        indent=2,
        width=1000,
    )


# ============================================================
# Validate generated YAML before writing
# ============================================================

def validate_yaml(yaml_text, expected_count):
    """
    Parse the generated YAML back into Python.

    This is a safety check.

    If PyYAML cannot read the generated text, or if the
    number of records changes, the existing YAML file will
    NOT be overwritten.
    """

    try:
        parsed = yaml.safe_load(yaml_text)

    except yaml.YAMLError as error:
        print()
        print(
            "❌ Generated YAML failed validation."
        )
        print(error)
        sys.exit(1)

    if not isinstance(parsed, list):
        print()
        print(
            "❌ Generated YAML is not a list of records."
        )
        sys.exit(1)

    actual_count = len(parsed)

    if actual_count != expected_count:
        print()
        print(
            "❌ Record count changed during YAML "
            "serialization."
        )
        print(
            f"   Expected: {expected_count}"
        )
        print(
            f"   Generated: {actual_count}"
        )
        sys.exit(1)

    print(
        f"✓ Generated YAML validated: "
        f"{actual_count} records"
    )


# ============================================================
# Write YAML
# ============================================================

def write_yaml(yaml_text):
    """
    Write the validated YAML text to _data/vocabulary.yml.
    """

    print()
    print(
        f"💾 Writing vocabulary to {DATA_PATH}..."
    )

    DATA_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    DATA_PATH.write_text(
        yaml_text,
        encoding="utf-8"
    )

    print(
        "✅ Vocabulary file updated successfully."
    )


# ============================================================
# Main
# ============================================================

def main():

    print()
    print("=================================")
    print(" Zodi Bell Vocabulary Export")
    print("=================================")
    print()

    # --------------------------------------------------------
    # Fetch records from Notion
    # --------------------------------------------------------

    pages = fetch_all_pages()

    if not pages:
        print(
            "❌ No vocabulary records were returned "
            "from Notion."
        )
        print(
            "   Existing YAML file was NOT changed."
        )
        sys.exit(1)

    # --------------------------------------------------------
    # Convert and validate records
    # --------------------------------------------------------

    records = convert_pages(pages)

    # --------------------------------------------------------
    # Create YAML
    # --------------------------------------------------------

    yaml_text = create_yaml(records)

    # --------------------------------------------------------
    # Validate the generated YAML BEFORE writing it
    # --------------------------------------------------------

    validate_yaml(
        yaml_text,
        expected_count=len(records)
    )

    # --------------------------------------------------------
    # Write the file
    # --------------------------------------------------------

    write_yaml(yaml_text)

    # --------------------------------------------------------
    # Done
    # --------------------------------------------------------

    print()
    print("================================")
    print(" Export complete!")
    print("================================")
    print()


if __name__ == "__main__":
    main()
