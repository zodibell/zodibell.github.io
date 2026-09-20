import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
import requests
import yaml
from pathlib import Path
from dotenv import load_dotenv


# ============================================================
# Load Environment
# ============================================================

# Load variables from the repository's .env file.
#
# This allows the script to use:
#
#     NOTION_TOKEN
#     NOTION_VOCABULARY_DATA_SOURCE_ID
#     NOTION_VERSION
#
load_dotenv()


# ============================================================
# Zodi Bell Vocabulary — Notion Export
# ============================================================
#
# PURPOSE
# -------
# This script exports the vocabulary stored in the Notion
# Vocabulary database back into:
#
#     _data/vocabulary.yml
#
# Notion is now the source of truth for the vocabulary.
#
# The YAML file is a generated file used by the Jekyll site.
#
# ============================================================
#
# WORKFLOW
# --------
#
#     Notion Vocabulary database
#             |
#             v
#     export-vocabulary.py
#             |
#             v
#     _data/vocabulary.yml
#             |
#             v
#          Jekyll
#
# ============================================================
#
# IMPORTANT
# ---------
# This script does NOT fetch definitions from external
# dictionary or Wikipedia APIs.
#
# All vocabulary data comes from Notion.
#
# The old fetch_definitions.py script was responsible for
# retrieving missing definitions. That is no longer necessary
# now that Notion contains the vocabulary data.
#
# ============================================================
#
# ENVIRONMENT VARIABLES
# ---------------------
#
# Your .env file should contain:
#
#     NOTION_TOKEN=your_secret_token
#
#     NOTION_VOCABULARY_DATA_SOURCE_ID=your_data_source_id
#
#     NOTION_VERSION=2026-03-11
#
# The token is intentionally never printed by this script.
#
# ============================================================
#
# EXPECTED NOTION PROPERTIES
# ---------------------------
#
# Term
#     Title
#
# Source Preference
#     Select
#
# Short Definition
#     Rich text
#
# Part of Speech
#     Select
#
# Etymology
#     Rich text
#
# Source
#     Select
#
# URL
#     URL
#
# Tags
#     Multi-select
#
# ============================================================
#
# EXPECTED YAML FIELDS
# --------------------
#
# term
# source_preference
# short_definition
# part_of_speech
# etymology
# source
# url
# tags
#
# ============================================================


# ============================================================
# Configuration
# ============================================================

# The YAML file Jekyll uses.
#
# This file is generated from your Notion Vocabulary database.
DATA_PATH = Path("_data/vocabulary.yml")


# Notion API endpoint used to query a data source.
NOTION_API_URL = (
    "https://api.notion.com/v1/data_sources/{}/query"
)


# Use the same Notion API version as the import script.
NOTION_VERSION = os.getenv(
    "NOTION_VERSION",
    "2026-03-11"
)


# Notion authentication.
NOTION_TOKEN = os.getenv(
    "NOTION_TOKEN"
)


# Vocabulary data source ID.
NOTION_VOCABULARY_DATA_SOURCE_ID = os.getenv(
    "NOTION_VOCABULARY_DATA_SOURCE_ID"
)


# ============================================================
# Validate Environment
# ============================================================

if not NOTION_TOKEN:
    raise RuntimeError(
        "NOTION_TOKEN environment variable is not set."
    )


if not NOTION_VOCABULARY_DATA_SOURCE_ID:
    raise RuntimeError(
        "NOTION_VOCABULARY_DATA_SOURCE_ID environment "
        "variable is not set."
    )


# ============================================================
# Notion Request Helpers
# ============================================================

def get_notion_headers():
    """
    Build the headers required by the Notion API.
    """

    return {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


# ============================================================
# Notion Property Helpers
# ============================================================

def get_property(properties, name):
    """
    Safely retrieve a Notion property.

    Returns the property object if it exists.
    Returns None if it does not exist.
    """

    property_data = properties.get(name)

    if property_data is None:
        print(
            f"⚠️ Notion property not found: {name}"
        )

    return property_data


def get_title(properties, name):
    """
    Extract text from a Notion title property.
    """

    property_data = get_property(
        properties,
        name
    )

    if not property_data:
        return None

    title = property_data.get(
        "title",
        []
    )

    if not title:
        return None

    value = "".join(
        item.get("plain_text", "")
        for item in title
    ).strip()

    return value or None


def get_rich_text(properties, name):
    """
    Extract text from a Notion rich_text property.

    Empty rich-text properties become None so that YAML
    receives null rather than an empty string.
    """

    property_data = get_property(
        properties,
        name
    )

    if not property_data:
        return None

    rich_text = property_data.get(
        "rich_text",
        []
    )

    if not rich_text:
        return None

    value = "".join(
        item.get("plain_text", "")
        for item in rich_text
    ).strip()

    return value or None


def get_select(properties, name):
    """
    Extract the selected value from a Notion select property.

    Empty select properties become None so that YAML
    receives null rather than an empty string.
    """

    property_data = get_property(
        properties,
        name
    )

    if not property_data:
        return None

    select = property_data.get(
        "select"
    )

    if not select:
        return None

    value = select.get(
        "name"
    )

    if not value:
        return None

    return value.strip() or None


def get_multi_select(properties, name):
    """
    Extract all selected values from a Notion multi-select
    property.

    An empty multi-select property becomes an empty list.
    """

    property_data = get_property(
        properties,
        name
    )

    if not property_data:
        return []

    values = property_data.get(
        "multi_select",
        []
    )

    return [
        item.get("name", "").strip()
        for item in values
        if item.get("name", "").strip()
    ]


def get_url(properties, name):
    """
    Extract a URL from a Notion URL property.

    Empty URL properties become None so that YAML receives
    null rather than an empty string.
    """

    property_data = get_property(
        properties,
        name
    )

    if not property_data:
        return None

    value = property_data.get(
        "url"
    )

    if not value:
        return None

    return value.strip() or None


# ============================================================
# Fetch Vocabulary from Notion
# ============================================================

def fetch_notion_vocabulary():
    """
    Fetch all vocabulary records from the Notion data source.

    Notion returns results in pages, so this function continues
    requesting records until there are no more pages.
    """

    url = NOTION_API_URL.format(
        NOTION_VOCABULARY_DATA_SOURCE_ID
    )

    headers = get_notion_headers()

    records = []

    start_cursor = None

    page_number = 1

    print(
        "🔍 Fetching vocabulary from Notion..."
    )

    print(
        f"   Data source: "
        f"{NOTION_VOCABULARY_DATA_SOURCE_ID}"
    )

    print(
        f"   Notion API version: {NOTION_VERSION}"
    )

    print()

    while True:
        payload = {}

        if start_cursor:
            payload[
                "start_cursor"
            ] = start_cursor

        print(
            f"📄 Fetching Notion page {page_number}..."
        )

        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
            )

        except requests.RequestException as e:
            raise RuntimeError(
                f"Notion request failed: {e}"
            ) from e

        # Debugging information.
        print(
            f"[DEBUG Notion] Page {page_number}: "
            f"{response.status_code}"
        )

        if response.status_code != 200:
            print(
                "⚠️ Notion API error:"
            )

            print(
                response.text[:1000]
            )

            raise RuntimeError(
                "Notion API request failed."
            )

        try:
            data = response.json()

        except ValueError as e:
            raise RuntimeError(
                f"Could not parse Notion response as JSON: {e}"
            ) from e

        page_results = data.get(
            "results",
            []
        )

        print(
            f"   Records returned: "
            f"{len(page_results)}"
        )

        records.extend(
            page_results
        )

        # Notion tells us whether another page exists.
        if not data.get(
            "has_more"
        ):
            break

        start_cursor = data.get(
            "next_cursor"
        )

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
# Convert Notion Record to YAML Record
# ============================================================

def notion_record_to_yaml(record):
    """
    Convert one Notion vocabulary record into the YAML
    structure expected by the Jekyll vocabulary page.

    The field names intentionally match the existing
    vocabulary.yml structure.
    """

    properties = record.get(
        "properties",
        {}
    )


    # --------------------------------------------------------
    # Term
    # --------------------------------------------------------

    term = get_title(
        properties,
        "Term"
    )


    # --------------------------------------------------------
    # Source Preference
    # --------------------------------------------------------

    source_preference = get_select(
        properties,
        "Source Preference"
    )


    # --------------------------------------------------------
    # Short Definition
    # --------------------------------------------------------

    short_definition = get_rich_text(
        properties,
        "Short Definition"
    )


    # --------------------------------------------------------
    # Part of Speech
    # --------------------------------------------------------

    part_of_speech = get_select(
        properties,
        "Part of Speech"
    )


    # --------------------------------------------------------
    # Etymology
    # --------------------------------------------------------

    etymology = get_rich_text(
        properties,
        "Etymology"
    )


    # --------------------------------------------------------
    # Source
    # --------------------------------------------------------
    #
    # IMPORTANT:
    #
    # "Source" is a Notion SELECT property, not rich text.
    #
    # This matches the schema in import-vocabulary.mjs.
    # --------------------------------------------------------

    source = get_select(
        properties,
        "Source"
    )


    # --------------------------------------------------------
    # URL
    # --------------------------------------------------------

    url = get_url(
        properties,
        "URL"
    )


    # --------------------------------------------------------
    # Tags
    # --------------------------------------------------------

    tags = get_multi_select(
        properties,
        "Tags"
    )


    # --------------------------------------------------------
    # Validate Term
    # --------------------------------------------------------

    if not term:
        print(
            "⚠️ Found a Notion record without a Term."
        )

        print(
            f"   Record ID: {record.get('id')}"
        )

        return None


    # --------------------------------------------------------
    # Debugging Information
    # --------------------------------------------------------

    print(
        f"✓ Processing: {term}"
    )


    # --------------------------------------------------------
    # Build YAML Record
    # --------------------------------------------------------
    #
    # None values are intentional.
    #
    # PyYAML will write:
    #
    #     null
    #
    # rather than:
    #
    #     ''
    #
    # This preserves the existing YAML data model.
    # --------------------------------------------------------

    entry = {
        "term": term,
        "source_preference": source_preference,
        "short_definition": short_definition,
        "part_of_speech": part_of_speech,
        "etymology": etymology,
        "source": source,
        "url": url,
        "tags": tags,
    }

    return entry


# ============================================================
# Validate Exported Records
# ============================================================

def validate_vocabulary(vocabulary):
    """
    Validate the records before replacing vocabulary.yml.

    This prevents an incomplete or malformed Notion response
    from accidentally replacing the working YAML file.
    """

    if not vocabulary:
        raise RuntimeError(
            "No valid vocabulary records were created."
        )


    # --------------------------------------------------------
    # Check for duplicate terms.
    # --------------------------------------------------------

    seen_terms = set()

    for index, entry in enumerate(
        vocabulary,
        start=1
    ):
        term = entry.get(
            "term"
        )

        if not term:
            raise RuntimeError(
                f"Vocabulary record #{index} "
                "does not have a term."
            )

        normalized = term.lower()

        if normalized in seen_terms:
            raise RuntimeError(
                f'Duplicate vocabulary term found: "{term}"'
            )

        seen_terms.add(
            normalized
        )


# ============================================================
# YAML Dumper
# ============================================================

class VocabularyDumper(yaml.SafeDumper):
    """
    Custom YAML dumper used to keep the generated file close
    to the formatting of the existing vocabulary.yml.

    In particular:
    
    - Lists are indented beneath their property.
    - Long definitions are not unnecessarily wrapped.
    - Unicode characters are preserved.
    """
    pass


def increase_list_indent(
    dumper,
    flow,
    indentless
):
    """
    Force nested YAML lists to be indented beneath their
    property name.

    This produces:

        tags:
          - nouns
          - politics

    instead of:

        tags:
        - nouns
        - politics
    """

    return yaml.SafeDumper.increase_indent(
        dumper,
        flow,
        False
    )


VocabularyDumper.increase_indent = (
    increase_list_indent
)


# ============================================================
# Write YAML
# ============================================================

def write_vocabulary_yaml(vocabulary):
    """
    Write the exported vocabulary to _data/vocabulary.yml.

    The file is only replaced after all records have been
    successfully fetched, converted, and validated.
    """

    print()

    print(
        f"💾 Writing vocabulary to {DATA_PATH}..."
    )

    try:
        with open(
            DATA_PATH,
            "w",
            encoding="utf-8"
        ) as f:

            yaml.dump(
                vocabulary,
                f,
                Dumper=VocabularyDumper,
                sort_keys=False,
                allow_unicode=True,
                default_flow_style=False,
                width=1000,
                indent=2,
            )

    except OSError as e:
        raise RuntimeError(
            f"Could not write {DATA_PATH}: {e}"
        ) from e

    print(
        "✅ Vocabulary file updated successfully."
    )

    print(
        f"   Records written: "
        f"{len(vocabulary)}"
    )


# ============================================================
# Main Update Process
# ============================================================

def update_vocabulary():
    """
    Fetch vocabulary from Notion and regenerate the Jekyll
    YAML data file.
    """

    print(
        "================================"
    )

    print(
        " Zodi Bell Vocabulary Export"
    )

    print(
        "================================"
    )

    print()


    # --------------------------------------------------------
    # Fetch records from Notion.
    # --------------------------------------------------------

    records = fetch_notion_vocabulary()


    # --------------------------------------------------------
    # Safety check.
    #
    # Never replace the YAML file with an empty export.
    # --------------------------------------------------------

    if not records:
        print(
            "⚠️ No vocabulary records were retrieved "
            "from Notion."
        )

        print(
            "   The YAML file was NOT changed."
        )

        return


    # --------------------------------------------------------
    # Convert Notion records to YAML records.
    # --------------------------------------------------------

    vocabulary = []

    print(
        "🔄 Converting Notion records to YAML..."
    )

    print()

    for record in records:
        entry = notion_record_to_yaml(
            record
        )

        if entry:
            vocabulary.append(
                entry
            )


    # --------------------------------------------------------
    # Make sure every Notion record converted successfully.
    #
    # This is an important safety check. If Notion returns
    # records that our exporter cannot understand, we do NOT
    # want to overwrite the working YAML file.
    # --------------------------------------------------------

    if len(vocabulary) != len(records):
        print()

        print(
            f"⚠️ Warning: Notion returned "
            f"{len(records)} records, but only "
            f"{len(vocabulary)} could be converted."
        )

        print(
            "   The YAML file was NOT changed."
        )

        return


    # --------------------------------------------------------
    # Validate the converted vocabulary.
    # --------------------------------------------------------

    validate_vocabulary(
        vocabulary
    )


    # --------------------------------------------------------
    # Sort alphabetically by term.
    #
    # This keeps the generated YAML predictable and makes
    # Git diffs easier to read.
    # --------------------------------------------------------

    vocabulary.sort(
        key=lambda entry: entry["term"].lower()
    )


    # --------------------------------------------------------
    # Write the YAML file.
    # --------------------------------------------------------

    write_vocabulary_yaml(
        vocabulary
    )


    # --------------------------------------------------------
    # Final summary.
    # --------------------------------------------------------

    print()

    print(
        "================================"
    )

    print(
        " Export complete!"
    )

    print(
        "================================"
    )


# ============================================================
# Run the Script
# ============================================================

if __name__ == "__main__":
    update_vocabulary()
