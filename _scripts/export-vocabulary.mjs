import "dotenv/config";
import fs from "fs";
import * as yaml from "js-yaml";

/*
 * Vocabulary Export — Notion → Jekyll YAML
 *
 * Purpose:
 *   Export the Notion Vocabulary database directly to:
 *
 *     _data/vocabulary_normalized.yml
 *
 * Notion is the source of truth.
 *
 * The exported YAML is the file Jekyll reads directly.
 *
 * IMPORTANT:
 *
 *   There is intentionally NO intermediate:
 *
 *     _data/vocabulary.yml
 *
 *   and there is NO longer a Jekyll normalization plugin.
 *
 *   The complete workflow is:
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
 * MODES
 * ============================================================
 *
 * Preview:
 *
 *   node _scripts/export-vocabulary.mjs --preview
 *
 * Preview mode:
 *   - Reads from Notion
 *   - Validates the Notion database
 *   - Converts records
 *   - Validates vocabulary data
 *   - Shows the export plan
 *   - Does NOT modify any files
 *
 *
 * Write:
 *
 *   node _scripts/export-vocabulary.mjs
 *
 * Write mode:
 *   - Performs all of the same validation
 *   - Writes the exported records to:
 *
 *       _data/vocabulary_normalized.yml
 *
 *
 * NOTION PROPERTIES
 * ============================================================
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
 * ENVIRONMENT VARIABLES
 * ============================================================
 *
 * Required:
 *
 *   NOTION_TOKEN
 *   NOTION_VOCABULARY_DATA_SOURCE_ID
 *
 * Optional:
 *
 *   NOTION_VERSION
 *
 *
 * NORMALIZATION
 * ============================================================
 *
 * The exporter preserves the original values from Notion for
 * display purposes.
 *
 * For example:
 *
 *   term: Marxism
 *
 * remains:
 *
 *   term: Marxism
 *
 * But a lowercase comparison value is also generated:
 *
 *   term_lc: marxism
 *
 * The same approach is used for tags.
 *
 * Original display values:
 *
 *   tags:
 *     - nouns
 *     - politics
 *     - Marxism
 *
 * Comparison values:
 *
 *   tags_lc:
 *     - nouns
 *     - politics
 *     - marxism
 *
 * This allows Jekyll to compare tags case-insensitively while
 * preserving the capitalization chosen in Notion for display.
 *
 *
 * IMPORTANT:
 *   This script does not enrich, edit, or otherwise modify Notion.
 *   It is strictly a Notion → YAML export.
 */


/* ============================================================
 * Configuration
 * ============================================================
 */

const NOTION_TOKEN = process.env.NOTION_TOKEN;

const DATA_SOURCE_ID =
  process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;

const NOTION_VERSION =
  process.env.NOTION_VERSION || "2026-03-11";

/*
 * Jekyll reads this file directly.
 */
const OUTPUT_FILE =
  "_data/vocabulary_normalized.yml";

/*
 * Preview mode is enabled when the command includes:
 *
 *   --preview
 */
const PREVIEW =
  process.argv.includes("--preview");


/*
 * Expected Notion database schema.
 *
 * The exporter validates this before reading the records.
 */
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
 * General Helpers
 * ============================================================
 */

/*
 * Stop the script with a clear error message.
 */
function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}


/*
 * Headers used for Notion API requests.
 */
function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}


/*
 * Make a request to the Notion API.
 *
 * The function:
 *   - adds the standard Notion headers
 *   - parses the JSON response
 *   - provides a useful error if the request fails
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

    throw new Error(
      `Notion API error: ${message}`
    );
  }

  return data;
}


/* ============================================================
 * Notion Property Helpers
 * ============================================================
 */


/*
 * Return the plain text contained in a Notion rich_text
 * property.
 *
 * Blank rich-text fields become null rather than an empty
 * string.
 */
function getRichText(property) {
  const value =
    property?.rich_text
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
 * Blank URL fields become null.
 */
function getUrl(property) {
  return property?.url || null;
}


/*
 * Return the title text from a Notion title property.
 */
function getTitle(property) {
  const value =
    property?.title
      ?.map((item) => item.plain_text)
      .join("");

  return value || null;
}


/*
 * Return the names from a Notion multi-select property.
 *
 * Example:
 *
 *   [
 *     "nouns",
 *     "politics",
 *     "Marxism"
 *   ]
 */
function getMultiSelect(property) {
  return (
    property?.multi_select
      ?.map((item) => item.name)
      .filter(Boolean) || []
  );
}


/* ============================================================
 * Normalization Helpers
 * ============================================================
 */


/*
 * Normalize a value for comparison.
 *
 * This does NOT change the value displayed on the site.
 *
 * For example:
 *
 *   Marxism
 *
 * becomes:
 *
 *   marxism
 *
 * while the original value remains:
 *
 *   Marxism
 */
function normalizeTerm(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


/*
 * Normalize every tag in a tag array.
 *
 * Example:
 *
 *   ["nouns", "politics", "Marxism"]
 *
 * becomes:
 *
 *   ["nouns", "politics", "marxism"]
 */
function normalizeTags(tags) {
  return tags.map((tag) =>
    normalizeTerm(tag)
  );
}


/* ============================================================
 * Convert Notion Page → Vocabulary Record
 * ============================================================
 */


/*
 * Convert one Notion page into the YAML structure used by
 * Jekyll.
 *
 * IMPORTANT:
 *
 * The original values are preserved.
 *
 * We add lowercase comparison fields separately:
 *
 *   term_lc
 *   tags_lc
 *
 * This allows the site to compare values without changing
 * what visitors see.
 */
function pageToVocabularyRecord(page) {
  const properties = page.properties;

  const term =
    getTitle(properties["Term"]);

  const tags =
    getMultiSelect(properties["Tags"]);

  return {
    term,

    source_preference:
      getSelect(properties["Source Preference"]),

    short_definition:
      getRichText(properties["Short Definition"]),

    part_of_speech:
      getSelect(properties["Part of Speech"]),

    etymology:
      getRichText(properties["Etymology"]),

    source:
      getSelect(properties["Source"]),

    url:
      getUrl(properties["URL"]),

    /*
     * Preserve the original tag capitalization.
     */
    tags,

    /*
     * Lowercase comparison values.
     *
     * These are used by Jekyll when matching tag pages.
     */
    tags_lc:
      normalizeTags(tags),

    /*
     * Lowercase comparison/sorting value for the term.
     */
    term_lc:
      normalizeTerm(term),
  };
}


/* ============================================================
 * Step 1: Validate Environment
 * ============================================================
 */

console.log("\n========================================");
console.log("Vocabulary Export — Notion → YAML");
console.log("========================================\n");


if (PREVIEW) {
  console.log(
    "MODE: Preview (no files will be changed)\n"
  );
} else {
  console.log("MODE: Write\n");
}


/*
 * Verify the required environment variables.
 */
if (!NOTION_TOKEN) {
  fail(
    "NOTION_TOKEN is not set in .env"
  );
}


if (!DATA_SOURCE_ID) {
  fail(
    "NOTION_VOCABULARY_DATA_SOURCE_ID is not set in .env"
  );
}


console.log(
  "Environment variables found."
);

console.log(
  `Notion version: ${NOTION_VERSION}`
);

console.log(
  `Data source ID: ${DATA_SOURCE_ID}`
);

console.log(
  `Output file: ${OUTPUT_FILE}\n`
);


/* ============================================================
 * Step 2: Verify the Notion Data Source
 * ============================================================
 */

console.log(
  "Step 1: Checking Notion data source..."
);


let dataSource;


try {
  dataSource =
    await notionRequest(
      `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}`
    );
} catch (error) {
  fail(error.message);
}


const dataSourceTitle =
  dataSource?.title
    ?.map((item) => item.plain_text)
    .join("") ||
  "Untitled";


console.log(
  `Connected to: ${dataSourceTitle}`
);


/* ============================================================
 * Step 3: Validate Notion Schema
 * ============================================================
 */

console.log(
  "\nStep 2: Validating Notion schema..."
);


const notionProperties =
  dataSource.properties || {};


let schemaErrors = 0;


for (
  const [propertyName, expectedType]
  of Object.entries(REQUIRED_PROPERTIES)
) {
  const property =
    notionProperties[propertyName];


  /*
   * Property does not exist.
   */
  if (!property) {
    console.error(
      `  MISSING: ${propertyName} (expected ${expectedType})`
    );

    schemaErrors++;

    continue;
  }


  /*
   * Property exists but has the wrong type.
   */
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


console.log(
  "Schema validation passed."
);


/* ============================================================
 * Step 4: Fetch All Notion Pages
 * ============================================================
 */

console.log(
  "\nStep 3: Fetching vocabulary records..."
);


const pages = [];

let startCursor =
  undefined;


while (true) {
  /*
   * Notion allows up to 100 records per request.
   */
  const body = {
    page_size: 100,
  };


  /*
   * Add the cursor when Notion has another page of results.
   */
  if (startCursor) {
    body.start_cursor =
      startCursor;
  }


  const result =
    await notionRequest(
      `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );


  pages.push(
    ...(result.results || [])
  );


  /*
   * Stop when Notion reports that there are no more pages.
   */
  if (!result.has_more) {
    break;
  }


  startCursor =
    result.next_cursor;


  /*
   * Safety check in case Notion says there are more records
   * but does not provide another cursor.
   */
  if (!startCursor) {
    fail(
      "Notion reported more records but did not provide a next cursor."
    );
  }
}


console.log(
  `Found ${pages.length} records.`
);


/* ============================================================
 * Step 5: Convert Notion Records
 * ============================================================
 */

console.log(
  "\nStep 4: Converting records..."
);


const vocabulary =
  pages.map(
    pageToVocabularyRecord
  );


console.log(
  `Converted ${vocabulary.length} records.`
);


/* ============================================================
 * Step 6: Validate Exported Vocabulary
 * ============================================================
 */

console.log(
  "\nStep 5: Validating exported vocabulary..."
);


let validationErrors = 0;


/*
 * Track normalized terms so that capitalization differences
 * cannot create duplicate vocabulary records.
 *
 * Example:
 *
 *   Marxism
 *   marxism
 *   MARXISM
 *
 * would be treated as duplicates.
 */
const seenTerms =
  new Map();


for (const record of vocabulary) {
  /*
   * Every vocabulary record must have a Term.
   */
  if (!record.term) {
    console.error(
      "  ERROR: Found a record without a Term."
    );

    validationErrors++;

    continue;
  }


  /*
   * Check for duplicate terms.
   */
  const normalized =
    normalizeTerm(record.term);


  if (seenTerms.has(normalized)) {
    console.error(
      `  DUPLICATE TERM: "${record.term}"`
    );

    console.error(
      `    Existing record: ${seenTerms.get(normalized)}`
    );

    validationErrors++;
  } else {
    seenTerms.set(
      normalized,
      record.term
    );
  }
}


/*
 * Validate expected fields.
 *
 * Optional fields such as Etymology and URL are intentionally
 * allowed to be empty.
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


console.log(
  "Validation passed."
);


/* ============================================================
 * Step 7: Sort Alphabetically
 * ============================================================
 */

console.log(
  "\nStep 6: Sorting vocabulary alphabetically..."
);


/*
 * Sort using the lowercase comparison value.
 *
 * This means:
 *
 *   Gestapo
 *   Houston
 *   Marxism
 *
 * sort naturally regardless of capitalization.
 */
vocabulary.sort(
  (a, b) =>
    a.term_lc.localeCompare(
      b.term_lc
    )
);


console.log(
  "Alphabetical sorting complete."
);


/* ============================================================
 * Step 8: Show Export Plan
 * ============================================================
 */

console.log(
  "\nStep 7: Export plan"
);

console.log(
  "----------------------------------------"
);


for (const record of vocabulary) {
  console.log(
    `  ${record.term}`
  );
}


console.log(
  "----------------------------------------"
);

console.log(
  `Total records: ${vocabulary.length}`
);


/* ============================================================
 * Step 9: Preview / Write
 * ============================================================
 */


/*
 * Preview mode stops here.
 *
 * Nothing is written to disk.
 */
if (PREVIEW) {
  console.log(
    "\n========================================"
  );

  console.log(
    "PREVIEW COMPLETE"
  );

  console.log(
    "========================================"
  );

  console.log(
    `\nNo files were changed. ${vocabulary.length} records would be exported to:`
  );

  console.log(
    `  ${OUTPUT_FILE}\n`
  );

  process.exit(0);
}


/*
 * Convert the vocabulary records to YAML.
 *
 * noRefs:
 *   Prevents YAML anchors/references.
 *
 * noCompatMode:
 *   Keeps the YAML output straightforward.
 *
 * lineWidth: -1:
 *   Prevents js-yaml from wrapping long definitions.
 */
const yamlOutput =
  yaml.dump(
    vocabulary,
    {
      noRefs: true,
      noCompatMode: true,
      lineWidth: -1,
    }
  );


/*
 * Write the generated YAML file.
 */
console.log(
  "\nStep 8: Writing YAML..."
);


fs.writeFileSync(
  OUTPUT_FILE,
  yamlOutput,
  "utf8"
);


console.log(
  `Wrote ${OUTPUT_FILE}`
);


/* ============================================================
 * Step 10: Final Summary
 * ============================================================
 */

console.log(
  "\n========================================"
);

console.log(
  "EXPORT COMPLETE"
);

console.log(
  "========================================"
);


console.log(
  `Records exported: ${vocabulary.length}`
);

console.log(
  `Output file:      ${OUTPUT_FILE}`
);


console.log(
  "\nNotion remains the source of truth."
);

console.log(
  "Jekyll reads _data/vocabulary_normalized.yml directly.\n"
);
