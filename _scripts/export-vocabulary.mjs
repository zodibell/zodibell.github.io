import "dotenv/config";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

// ============================================================
// Zodi Bell Vocabulary — Notion → YAML Export
// ============================================================
//
// This script exports the Vocabulary database in Notion to:
//
//   _data/vocabulary.yml
//
// MODES:
//
// Preview:
//   node _scripts/export-vocabulary.mjs --preview
//
// Write:
//   node _scripts/export-vocabulary.mjs
//
// Preview mode does NOT modify the YAML file.
//
// The goal of this script is to make Notion the source of truth
// while allowing the existing Jekyll site to continue using:
//
//   _data/vocabulary.yml
//
// IMPORTANT:
// - This script reads from Notion.
// - This script never changes Notion.
// - The exported YAML replaces the existing vocabulary.yml
//   only when run without --preview.
// ============================================================

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;
const NOTION_VERSION = process.env.NOTION_VERSION || "2026-03-11";

const ROOT_DIR = process.cwd();
const YAML_PATH = path.join(ROOT_DIR, "_data", "vocabulary.yml");

const PREVIEW = process.argv.includes("--preview");

// ============================================================
// Configuration
// ============================================================

const NOTION_API_BASE = "https://api.notion.com/v1";

// ============================================================
// Validation
// ============================================================

if (!NOTION_TOKEN) {
  console.error("ERROR: NOTION_TOKEN is not set in .env");
  process.exit(1);
}

if (!DATA_SOURCE_ID) {
  console.error(
    "ERROR: NOTION_VOCABULARY_DATA_SOURCE_ID is not set in .env"
  );
  process.exit(1);
}

// ============================================================
// Helpers
// ============================================================

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...notionHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Notion API request failed (${response.status} ${response.statusText})\n${body}`
    );
  }

  return response.json();
}

// ============================================================
// Notion property readers
// ============================================================

function getTitle(property) {
  if (!property || property.type !== "title") {
    return "";
  }

  return property.title
    ?.map((item) => item.plain_text || "")
    .join("")
    .trim() || "";
}

function getRichText(property) {
  if (!property || property.type !== "rich_text") {
    return "";
  }

  return property.rich_text
    ?.map((item) => item.plain_text || "")
    .join("")
    .trim() || "";
}

function getSelect(property) {
  if (!property || property.type !== "select") {
    return "";
  }

  return property.select?.name || "";
}

function getUrl(property) {
  if (!property || property.type !== "url") {
    return "";
  }

  return property.url || "";
}

function getMultiSelect(property) {
  if (!property || property.type !== "multi_select") {
    return [];
  }

  return (
    property.multi_select
      ?.map((item) => item.name)
      .filter(Boolean) || []
  );
}

// ============================================================
// Fetch data source
// ============================================================

async function fetchDataSource() {
  console.log("Checking Notion data source...");

  const dataSource = await notionRequest(
    `${NOTION_API_BASE}/data_sources/${DATA_SOURCE_ID}`
  );

  console.log(
    `✓ Connected to Notion data source: ${
      dataSource.title?.[0]?.plain_text || "Vocabulary"
    }`
  );

  return dataSource;
}

// ============================================================
// Validate Notion schema
// ============================================================

function validateSchema(dataSource) {
  console.log("\nChecking Notion property schema...");

  const properties = dataSource.properties || {};

  const requiredProperties = {
    Term: "title",
    "Source Preference": "select",
    "Short Definition": "rich_text",
    "Part of Speech": "select",
    Etymology: "rich_text",
    Source: "select",
    URL: "url",
    Tags: "multi_select",
  };

  const errors = [];

  for (const [name, expectedType] of Object.entries(requiredProperties)) {
    if (!properties[name]) {
      errors.push(`Missing property: ${name}`);
      continue;
    }

    if (properties[name].type !== expectedType) {
      errors.push(
        `${name}: expected ${expectedType}, found ${properties[name].type}`
      );
    }
  }

  if (errors.length > 0) {
    console.error("\nERROR: Notion property schema does not match expectations.\n");

    for (const error of errors) {
      console.error(`  - ${error}`);
    }

    process.exit(1);
  }

  console.log("✓ Notion property schema looks correct.");
}

// ============================================================
// Fetch all vocabulary pages
// ============================================================
//
// Notion paginates database/data-source queries.
// This function continues requesting pages until there are no
// more results.
//

async function fetchAllPages() {
  console.log("\nFetching Vocabulary records from Notion...");

  const pages = [];
  let startCursor = undefined;

  while (true) {
    const body = {
      page_size: 100,
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }

    const result = await notionRequest(
      `${NOTION_API_BASE}/data_sources/${DATA_SOURCE_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    pages.push(...(result.results || []));

    if (!result.has_more) {
      break;
    }

    startCursor = result.next_cursor;
  }

  console.log(`✓ Found ${pages.length} Vocabulary record(s).`);

  return pages;
}

// ============================================================
// Convert Notion page → YAML record
// ============================================================

function pageToVocabularyRecord(page) {
  const properties = page.properties || {};

  return {
    term: getTitle(properties.Term),
    source_preference: getSelect(properties["Source Preference"]),
    short_definition: getRichText(properties["Short Definition"]),
    part_of_speech: getSelect(properties["Part of Speech"]),
    etymology: getRichText(properties.Etymology),
    source: getSelect(properties.Source),
    url: getUrl(properties.URL),
    tags: getMultiSelect(properties.Tags),
  };
}

// ============================================================
// Validate exported records
// ============================================================

function validateVocabulary(records) {
  console.log("\nValidating exported vocabulary...");

  const errors = [];
  const terms = new Set();

  records.forEach((record, index) => {
    const label = `Record ${index + 1}`;

    if (!record.term) {
      errors.push(`${label}: missing term`);
    }

    const normalizedTerm = record.term.toLowerCase();

    if (terms.has(normalizedTerm)) {
      errors.push(`Duplicate term: ${record.term}`);
    }

    terms.add(normalizedTerm);

    if (!Array.isArray(record.tags)) {
      errors.push(`${record.term}: tags must be an array`);
    }
  });

  if (errors.length > 0) {
    console.error("\nERROR: Export validation failed.\n");

    for (const error of errors) {
      console.error(`  - ${error}`);
    }

    process.exit(1);
  }

  console.log("✓ Export validation passed.");
}

// ============================================================
// Sort vocabulary
// ============================================================

function sortVocabulary(records) {
  return [...records].sort((a, b) =>
    a.term.localeCompare(b.term, undefined, {
      sensitivity: "base",
    })
  );
}

// ============================================================
// Write YAML
// ============================================================

function writeYaml(records) {
  const yamlText = yaml.dump(records, {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });

  fs.writeFileSync(YAML_PATH, yamlText, "utf8");
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("==============================================");
  console.log("Zodi Bell Vocabulary — Notion → YAML Export");
  console.log("==============================================");
  console.log(`Data source: ${DATA_SOURCE_ID}`);
  console.log(`YAML file: ${YAML_PATH}`);
  console.log(`Notion API version: ${NOTION_VERSION}`);
  console.log();

  if (PREVIEW) {
    console.log("PREVIEW MODE");
    console.log("No changes will be made to vocabulary.yml.");
  } else {
    console.log("WRITE MODE");
    console.log("vocabulary.yml WILL be replaced with the Notion export.");
  }

  console.log("==============================================\n");

  // ----------------------------------------------------------
  // Step 1: Verify the Notion data source
  // ----------------------------------------------------------

  const dataSource = await fetchDataSource();

  // ----------------------------------------------------------
  // Step 2: Verify the Notion schema
  // ----------------------------------------------------------

  validateSchema(dataSource);

  // ----------------------------------------------------------
  // Step 3: Fetch all records
  // ----------------------------------------------------------

  const pages = await fetchAllPages();

  if (pages.length === 0) {
    console.error(
      "\nERROR: No Vocabulary records were found in Notion."
    );

    console.error(
      "The YAML file will not be changed."
    );

    process.exit(1);
  }

  // ----------------------------------------------------------
  // Step 4: Convert Notion records to vocabulary records
  // ----------------------------------------------------------

  console.log("\nConverting Notion records to YAML records...");

  const records = pages.map(pageToVocabularyRecord);

  console.log(`✓ Converted ${records.length} record(s).`);

  // ----------------------------------------------------------
  // Step 5: Validate records
  // ----------------------------------------------------------

  validateVocabulary(records);

  // ----------------------------------------------------------
  // Step 6: Sort alphabetically
  // ----------------------------------------------------------

  const sortedRecords = sortVocabulary(records);

  // ----------------------------------------------------------
  // Step 7: Show export plan
  // ----------------------------------------------------------

  console.log("\n==============================================");
  console.log("EXPORT PLAN");
  console.log("==============================================");

  sortedRecords.forEach((record) => {
    console.log(`EXPORT: ${record.term}`);
  });

  console.log("\n==============================================");
  console.log("EXPORT SUMMARY");
  console.log("==============================================");

  console.log(`Records in Notion: ${sortedRecords.length}`);
  console.log(`Records to export:  ${sortedRecords.length}`);
  console.log(`Destination:        ${YAML_PATH}`);

  // ----------------------------------------------------------
  // Step 8: Preview or write
  // ----------------------------------------------------------

  if (PREVIEW) {
    console.log("\nNo changes were made to vocabulary.yml.");
    return;
  }

  console.log("\nWriting vocabulary.yml...");

  writeYaml(sortedRecords);

  console.log("✓ vocabulary.yml updated successfully.");

  console.log("\n==============================================");
  console.log("EXPORT COMPLETE");
  console.log("==============================================");
}

main().catch((error) => {
  console.error("\nERROR:");
  console.error(error.message);
  process.exit(1);
});
