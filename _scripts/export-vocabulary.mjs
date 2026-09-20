import "dotenv/config";
import fs from "fs";
import * as yaml from "js-yaml";

/*
 * Vocabulary Export — Notion → Jekyll Normalized YAML
 *
 * Purpose:
 *   Export the Notion Vocabulary database directly to:
 *
 *     _data/vocabulary_normalized.yml
 *
 * Notion is the source of truth.
 *
 * The exporter performs both the export and the normalization that
 * was previously handled by _plugins/normalize_vocab.rb.
 *
 * The data flow is:
 *
 *     Notion
 *       ↓
 *     export-vocabulary.mjs
 *       ↓
 *     _data/vocabulary_normalized.yml
 *       ↓
 *     Jekyll
 *
 *
 * MODES:
 *
 * Preview:
 *   node _scripts/export-vocabulary.mjs --preview
 *
 * Write:
 *   node _scripts/export-vocabulary.mjs
 *
 *
 * Preview mode:
 *   - Reads from Notion
 *   - Validates the database
 *   - Converts records
 *   - Normalizes records
 *   - Checks for duplicate terms
 *   - Sorts the records
 *   - Shows the export plan
 *   - Does NOT modify any files
 *
 *
 * Write mode:
 *   - Performs all of the same validation and normalization
 *   - Writes the normalized records to:
 *
 *       _data/vocabulary_normalized.yml
 *
 *
 * NORMALIZATION:
 *
 *   The exporter intentionally preserves the displayed Term exactly
 *   as it appears in Notion.
 *
 *   For example:
 *
 *       Gestapo  → term: Gestapo
 *       Marxism  → term: Marxism
 *       Houston  → term: Houston
 *
 *   A separate lowercase helper field is generated:
 *
 *       Gestapo  → term_lc: gestapo
 *       Marxism  → term_lc: marxism
 *       Houston  → term_lc: houston
 *
 *   This means proper-noun capitalization is never lost.
 *
 *   term_lc is used for comparisons and sorting-related operations.
 *
 *
 * The script does not enrich or modify Notion.
 * It is strictly a Notion → normalized YAML export.
 *
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
 *
 * IMPORTANT:
 *   This script intentionally preserves the values stored in Notion.
 *   It does not attempt to "clean up" or correct vocabulary data.
 *
 *   The only derived field is term_lc, which is generated from Term
 *   for case-insensitive comparisons.
 */


const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;
const NOTION_VERSION = process.env.NOTION_VERSION || "2026-03-11";

const OUTPUT_FILE = "_data/vocabulary_normalized.yml";
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


/*
 * Stop the script with an error message.
 */
function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}


/*
 * Headers used for all Notion API requests.
 */
function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}


/*
 * Make a request to the Notion API and return parsed JSON.
 */
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
 * vocabulary data.
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
 *
 * IMPORTANT:
 * The value is returned exactly as stored in Notion.
 *
 * We do NOT lowercase or otherwise alter the Term.
 *
 * This is important for proper nouns such as:
 *
 *   Gestapo
 *   Marxism
 *   Houston
 */
function getTitle(property) {
  const value = property?.title
    ?.map((item) => item.plain_text)
    .join("");

  return value || null;
}


/*
 * Return the names from a Notion multi-select property.
 *
 * Tag capitalization is also preserved exactly as stored in Notion.
 */
function getMultiSelect(property) {
  return (
    property?.multi_select
      ?.map((item) => item.name)
      .filter(Boolean) || []
  );
}


/*
 * Normalize a term for comparison.
 *
 * IMPORTANT:
 * This function does NOT modify the displayed Term.
 *
 * Example:
 *
 *   "Gestapo" → "gestapo"
 *   "Marxism" → "marxism"
 *   "Houston" → "houston"
 *
 * The lowercase value is stored separately in term_lc.
 */
function normalizeTerm(term) {
  return String(term || "")
    .trim()
    .toLowerCase();
}


/*
 * Convert a Notion page into the normalized YAML vocabulary format.
 *
 * The original Term is preserved.
 *
 * The derived term_lc field replaces the work previously performed
 * by normalize_vocab.rb.
 */
function pageToVocabularyRecord(page) {
  const properties = page.properties;

  const term = getTitle(properties["Term"]);

  return {
    term,
    source_preference: getSelect(properties["Source Preference"]),
    short_definition: getRichText(properties["Short Definition"]),
    part_of_speech: getSelect(properties["Part of Speech"]),
    etymology: getRichText(properties["Etymology"]),
    source: getSelect(properties["Source"]),
    url: getUrl(properties["URL"]),
    tags: getMultiSelect(properties["Tags"]),

    /*
     * Derived normalization field.
     *
     * This does NOT replace term.
     *
     * For example:
     *
     *   term: Gestapo
     *   term_lc: gestapo
     */
    term_lc: normalizeTerm(term),
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
 * Step 5: Convert and normalize Notion records
 * ============================================================
 */


console.log("\nStep 4: Converting and normalizing records...");


const vocabulary = pages.map(pageToVocabularyRecord);


console.log(`Converted ${vocabulary.length} records.`);


/*
 * Show a small confirmation that capitalization is being preserved.
 *
 * This is informational only and does not modify the data.
 */
console.log("\nNormalization behavior:");
console.log("  • Term capitalization is preserved.");
console.log("  • term_lc is generated for lowercase comparison.");
console.log("  • Tag capitalization is preserved.");


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
      "  ERROR: Found a record without a Term."
    );

    validationErrors++;
    continue;
  }


  /*
   * term_lc should always exist when term exists.
   */
  if (!record.term_lc) {
    console.error(
      `  ERROR: ${record.term} does not have a term_lc value.`
    );

    validationErrors++;
    continue;
  }


  /*
   * Check for duplicate terms.
   *
   * Comparison is case-insensitive.
   *
   * Therefore:
   *
   *   Gestapo
   *   gestapo
   *
   * would be considered duplicates.
   */
  if (seenTerms.has(record.term_lc)) {
    console.error(
      `  DUPLICATE TERM: "${record.term}"`
    );

    console.error(
      `    Existing term: ${seenTerms.get(record.term_lc)}`
    );

    validationErrors++;
  } else {
    seenTerms.set(record.term_lc, record.term);
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


/*
 * Sort using term_lc rather than modifying the displayed Term.
 *
 * This means:
 *
 *   Gestapo
 *   Marxism
 *   clerisy
 *
 * retain their original capitalization while still sorting
 * without capitalization affecting the order.
 */
console.log("\nStep 6: Sorting vocabulary alphabetically...");


vocabulary.sort((a, b) =>
  a.term_lc.localeCompare(b.term_lc, undefined, {
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
  console.log(
    `  ${record.term} → term_lc: ${record.term_lc}`
  );
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
 * noRefs:
 *   Prevents YAML anchors/references.
 *
 * noCompatMode:
 *   Keeps the output straightforward and readable.
 *
 * lineWidth:
 *   Prevents js-yaml from aggressively wrapping long values.
 */
const yamlOutput = yaml.dump(vocabulary, {
  noRefs: true,
  noCompatMode: true,
  lineWidth: -1,
});


/* ============================================================
 * Step 10: Write the normalized YAML file
 * ============================================================
 */


console.log("\nStep 8: Writing normalized YAML...");


fs.writeFileSync(
  OUTPUT_FILE,
  yamlOutput,
  "utf8"
);


console.log(`Wrote ${OUTPUT_FILE}`);


/* ============================================================
 * Step 11: Final summary
 * ============================================================
 */


console.log("\n========================================");
console.log("EXPORT COMPLETE");
console.log("========================================");


console.log(`Records exported: ${vocabulary.length}`);
console.log(`Output file:      ${OUTPUT_FILE}`);


console.log("\nNormalization performed by:");
console.log("  _scripts/export-vocabulary.mjs");


console.log("\nNotion remains the source of truth.");
console.log(
  "Jekyll reads _data/vocabulary_normalized.yml directly.\n"
);
