import "dotenv/config";
import fs from "fs";
import * as yaml from "js-yaml";

/*
 * Vocabulary Export — Notion → Jekyll YAML
 *
 * Purpose:
 *   Export the Notion Vocabulary database to:
 *
 *     _data/vocabulary.yml
 *
 * This allows Notion to become the source of truth while
 * keeping the existing Jekyll vocabulary page working.
 *
 * MODES:
 *
 * Preview:
 *   node _scripts/export-vocabulary.mjs --preview
 *
 * Write:
 *   node _scripts/export-vocabulary.mjs
 *
 * Preview mode:
 *   - Reads from Notion
 *   - Validates the database
 *   - Converts records
 *   - Shows the export plan
 *   - Does NOT modify any files
 *
 * Write mode:
 *   - Performs all of the same validation
 *   - Writes the exported records to:
 *
 *       _data/vocabulary.yml
 *
 * The script does not enrich or modify Notion.
 * It is strictly a Notion → YAML export.
 *
 * Expected Notion properties:
 *
 *   Term              → title
 *   Source Preference → select
 *   Short Definition  → rich_text
 *   Part of Speech    → select
 *   Etymology         → rich_text
 *   Source            → select
 *   URL               → url
 *   Tags              → multi_select
 *
 * Environment variables:
 *
 *   NOTION_TOKEN
 *   NOTION_VOCABULARY_DATA_SOURCE_ID
 *
 * Optional:
 *
 *   NOTION_VERSION
 *
 * IMPORTANT:
 *   This script intentionally preserves the values stored in Notion.
 *   It does not attempt to "clean up" or correct vocabulary data.
 */

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;
const NOTION_VERSION = process.env.NOTION_VERSION || "2026-03-11";

const OUTPUT_FILE = "_data/vocabulary.yml";
const PREVIEW = process.argv.includes("--preview");

const REQUIRED_PROPERTIES = {
  "Term": "title",
  "Source Preference": "select",
  "Short Definition": "rich_text",
  "Part of Speech": "select",
  "Etymology": "rich_text",
  "Source": "select",
  "URL": "url",
  "Tags": "multi_select",
};


/* ============================================================
 * Helpers
 * ============================================================
 */

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}


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

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Notion returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `HTTP ${response.status}`;

    throw new Error(`Notion API error: ${message}`);
  }

  return data;
}


/*
 * Return the plain text contained in a Notion rich_text property.
 *
 * IMPORTANT:
 * Blank Notion rich-text fields are returned as null rather than
 * an empty string. This preserves the representation used by the
 * original vocabulary.yml file.
 */
function getRichText(property) {
  const value = property?.rich_text
    ?.map((item) => item.plain_text)
    .join("");

  return value || null;
}


/*
 * Return the selected value from a Notion select property.
 */
function getSelect(property) {
  return property?.select?.name ?? null;
}


/*
 * Return the URL from a Notion URL property.
 *
 * IMPORTANT:
 * Blank Notion URL fields are returned as null rather than
 * an empty string.
 */
function getUrl(property) {
  return property?.url || null;
}


/*
 * Return the title text from a Notion title property.
 */
function getTitle(property) {
  const value = property?.title
    ?.map((item) => item.plain_text)
    .join("");

  return value || null;
}


/*
 * Return the names from a Notion multi-select property.
 */
function getMultiSelect(property) {
  return (
    property?.multi_select
      ?.map((item) => item.name)
      .filter(Boolean) || []
  );
}


/*
 * Normalize terms for comparison.
 *
 * This lets us identify the same word even if capitalization
 * differs.
 */
function normalizeTerm(term) {
  return String(term || "")
    .trim()
    .toLowerCase();
}


/*
 * Convert a Notion page into the YAML vocabulary format.
 */
function pageToVocabularyRecord(page) {
  const properties = page.properties;

  return {
    term: getTitle(properties["Term"]),
    source_preference: getSelect(properties["Source Preference"]),
    short_definition: getRichText(properties["Short Definition"]),
    part_of_speech: getSelect(properties["Part of Speech"]),
    etymology: getRichText(properties["Etymology"]),
    source: getSelect(properties["Source"]),
    url: getUrl(properties["URL"]),
    tags: getMultiSelect(properties["Tags"]),
  };
}


/* ============================================================
 * Step 1: Validate environment
 * ============================================================
 */

console.log("\n========================================");
console.log("Vocabulary Export — Notion → YAML");
console.log("========================================\n");

if (PREVIEW) {
  console.log("MODE: Preview (no files will be changed)\n");
} else {
  console.log("MODE: Write\n");
}

if (!NOTION_TOKEN) {
  fail("NOTION_TOKEN is not set in .env");
}

if (!DATA_SOURCE_ID) {
  fail("NOTION_VOCABULARY_DATA_SOURCE_ID is not set in .env");
}

console.log("Environment variables found.");
console.log(`Notion version: ${NOTION_VERSION}`);
console.log(`Data source ID: ${DATA_SOURCE_ID}`);
console.log(`Output file: ${OUTPUT_FILE}\n`);


/* ============================================================
 * Step 2: Verify the Notion data source
 * ============================================================
 */

console.log("Step 1: Checking Notion data source...");

let dataSource;

try {
  dataSource = await notionRequest(
    `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}`
  );
} catch (error) {
  fail(error.message);
}

const dataSourceTitle =
  dataSource?.title?.map((item) => item.plain_text).join("") ||
  "Untitled";

console.log(`Connected to: ${dataSourceTitle}`);


/* ============================================================
 * Step 3: Validate the Notion schema
 * ============================================================
 */

console.log("\nStep 2: Validating Notion schema...");

const notionProperties = dataSource.properties || {};

let schemaErrors = 0;

for (const [propertyName, expectedType] of Object.entries(
  REQUIRED_PROPERTIES
)) {
  const property = notionProperties[propertyName];

  if (!property) {
    console.error(
      `  MISSING: ${propertyName} (expected ${expectedType})`
    );
    schemaErrors++;
    continue;
  }

  if (property.type !== expectedType) {
    console.error(
      `  WRONG TYPE: ${propertyName} — expected ${expectedType}, found ${property.type}`
    );
    schemaErrors++;
    continue;
  }

  console.log(
    `  ✓ ${propertyName} (${expectedType})`
  );
}

if (schemaErrors > 0) {
  fail(
    `Schema validation failed with ${schemaErrors} problem(s).`
  );
}

console.log("Schema validation passed.");


/* ============================================================
 * Step 4: Fetch all Notion pages
 * ============================================================
 */

console.log("\nStep 3: Fetching vocabulary records...");

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
    `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`,
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

console.log(`Found ${pages.length} records.`);


/* ============================================================
 * Step 5: Convert Notion records to YAML records
 * ============================================================
 */

console.log("\nStep 4: Converting records...");

const vocabulary = pages.map(pageToVocabularyRecord);

console.log(`Converted ${vocabulary.length} records.`);


/* ============================================================
 * Step 6: Validate exported vocabulary
 * ============================================================
 */

console.log("\nStep 5: Validating exported vocabulary...");

let validationErrors = 0;

const seenTerms = new Map();

for (const record of vocabulary) {
  /*
   * Every record must have a term.
   */
  if (!record.term) {
    console.error(
      `  ERROR: Found a record without a Term.`
    );
    validationErrors++;
    continue;
  }

  /*
   * Check for duplicate terms.
   */
  const normalized = normalizeTerm(record.term);

  if (seenTerms.has(normalized)) {
    console.error(
      `  DUPLICATE TERM: "${record.term}"`
    );
    console.error(
      `    Existing page: ${seenTerms.get(normalized)}`
    );
    validationErrors++;
  } else {
    seenTerms.set(normalized, record.term);
  }
}


/*
 * Validate expected fields.
 *
 * We intentionally do not require optional fields such as
 * etymology or URL to contain values.
 */
for (const record of vocabulary) {
  if (!record.term) {
    continue;
  }

  if (!record.source_preference) {
    console.error(
      `  WARNING: ${record.term} has no Source Preference.`
    );
  }

  if (!record.short_definition) {
    console.error(
      `  WARNING: ${record.term} has no Short Definition.`
    );
  }

  if (!record.part_of_speech) {
    console.error(
      `  WARNING: ${record.term} has no Part of Speech.`
    );
  }

  if (!record.source) {
    console.error(
      `  WARNING: ${record.term} has no Source.`
    );
  }
}

if (validationErrors > 0) {
  fail(
    `Validation failed with ${validationErrors} error(s).`
  );
}

console.log("Validation passed.");


/* ============================================================
 * Step 7: Sort alphabetically
 * ============================================================
 */

console.log("\nStep 6: Sorting vocabulary alphabetically...");

vocabulary.sort((a, b) =>
  a.term.localeCompare(b.term, undefined, {
    sensitivity: "base",
  })
);

console.log("Alphabetical sorting complete.");


/* ============================================================
 * Step 8: Show export plan
 * ============================================================
 */

console.log("\nStep 7: Export plan");
console.log("----------------------------------------");

for (const record of vocabulary) {
  console.log(`  ${record.term}`);
}

console.log("----------------------------------------");
console.log(`Total records: ${vocabulary.length}`);


/* ============================================================
 * Step 9: Preview / write
 * ============================================================
 */

if (PREVIEW) {
  console.log("\n========================================");
  console.log("PREVIEW COMPLETE");
  console.log("========================================");

  console.log(
    `\nNo files were changed. ${vocabulary.length} records would be exported to:`
  );

  console.log(`  ${OUTPUT_FILE}\n`);

  process.exit(0);
}


/*
 * Convert to YAML.
 *
 * noCompatMode keeps the output straightforward and readable.
 */
const yamlOutput = yaml.dump(vocabulary, {
  noRefs: true,
  noCompatMode: true,
  lineWidth: -1,
});


/*
 * Write the YAML file.
 */
console.log("\nStep 8: Writing YAML...");

fs.writeFileSync(
  OUTPUT_FILE,
  yamlOutput,
  "utf8"
);

console.log(`Wrote ${OUTPUT_FILE}`);


/* ============================================================
 * Step 10: Final summary
 * ============================================================
 */

console.log("\n========================================");
console.log("EXPORT COMPLETE");
console.log("========================================");

console.log(`Records exported: ${vocabulary.length}`);
console.log(`Output file:      ${OUTPUT_FILE}`);

console.log("\nNotion remains the source of truth.");
console.log("The Jekyll site can continue reading _data/vocabulary.yml.\n");
