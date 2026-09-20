import "dotenv/config";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

/*
 * ============================================================
 * Zodi Bell Vocabulary — Notion Migration
 * ============================================================
 *
 * PURPOSE
 * -------
 * This script imports the existing vocabulary stored in:
 *
 *     _data/vocabulary.yml
 *
 * into the Notion Vocabulary database.
 *
 * The goal is to make Notion the future source of truth for
 * the vocabulary while preserving the data that already exists
 * in the YAML file.
 *
 * ============================================================
 *
 * MODES
 * -----
 *
 * Preview:
 *
 *     node scripts/import-vocabulary.js --preview
 *
 * Preview mode:
 *
 *     - Reads your YAML file.
 *     - Reads the existing records from Notion.
 *     - Shows what would be created or updated.
 *     - DOES NOT change Notion.
 *
 *
 * Import:
 *
 *     node scripts/import-vocabulary.js
 *
 * Normal mode:
 *
 *     - Creates missing vocabulary records in Notion.
 *     - Does not overwrite existing records by default.
 *
 *
 * Update existing records:
 *
 *     node scripts/import-vocabulary.js --update-existing
 *
 * This mode allows the script to update an existing Notion
 * record when the matching Term already exists.
 *
 * ============================================================
 *
 * IMPORTANT SAFETY RULE
 * ---------------------
 * The script matches records using the Term field,
 * case-insensitively.
 *
 * For example:
 *
 *     "perhorresce"
 *
 * and
 *
 *     "Perhorresce"
 *
 * are treated as the same term.
 *
 * Existing records are NOT updated unless you explicitly use:
 *
 *     --update-existing
 *
 * This makes the first import safer.
 *
 * ============================================================
 *
 * ENVIRONMENT VARIABLES
 * ---------------------
 *
 * Your .env file should contain:
 *
 *     NOTION_TOKEN=your_secret_token
 *
 *     NOTION_VOCABULARY_DATA_SOURCE_ID=your_data_source_id
 *
 * The token is intentionally never printed by this script.
 *
 * ============================================================
 *
 * EXPECTED NOTION PROPERTIES
 * ---------------------------
 *
 * Term
 *     Title
 *
 * Source Preference
 *     Select
 *
 * Short Definition
 *     Rich text
 *
 * Part of Speech
 *     Select
 *
 * Etymology
 *     Rich text
 *
 * Source
 *     Select
 *
 * URL
 *     URL
 *
 * Tags
 *     Multi-select
 *
 * ============================================================
 *
 * EXPECTED YAML FIELDS
 * --------------------
 *
 * term
 * source_preference
 * short_definition
 * part_of_speech
 * etymology
 * source
 * url
 * tags
 *
 * ============================================================
 */

// ============================================================
// Configuration
// ============================================================

const NOTION_API_BASE_URL =
  "https://api.notion.com/v1";

const NOTION_VERSION =
  process.env.NOTION_VERSION || "2026-03-11";

const DATA_PATH =
  path.resolve("_data/vocabulary.yml");

const notionToken =
  process.env.NOTION_TOKEN;

const notionDataSourceId =
  process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;


// ============================================================
// Validate Environment
// ============================================================

if (!notionToken) {
  throw new Error(
    [
      "NOTION_TOKEN is not set.",
      "",
      "Make sure your .env file contains:",
      "",
      "NOTION_TOKEN=your_secret_token",
    ].join("\n")
  );
}

if (!notionDataSourceId) {
  throw new Error(
    [
      "NOTION_VOCABULARY_DATA_SOURCE_ID is not set.",
      "",
      "Make sure your .env file contains:",
      "",
      "NOTION_VOCABULARY_DATA_SOURCE_ID=your_data_source_id",
    ].join("\n")
  );
}


// ============================================================
// Mode
// ============================================================

const previewMode =
  process.argv.includes("--preview");

const updateExisting =
  process.argv.includes("--update-existing");


// ============================================================
// Startup Information
// ============================================================

console.log(
  "=============================================="
);

console.log(
  "Zodi Bell Vocabulary — Notion Migration"
);

console.log(
  "=============================================="
);

console.log(
  `Data source: ${notionDataSourceId}`
);

console.log(
  `YAML file: ${DATA_PATH}`
);

console.log(
  `Notion API version: ${NOTION_VERSION}`
);

console.log("");

if (previewMode) {
  console.log(
    "PREVIEW MODE"
  );

  console.log(
    "No changes will be made to Notion."
  );
} else {
  console.log(
    "WRITE MODE"
  );

  if (updateExisting) {
    console.log(
      "Existing matching records MAY be updated."
    );
  } else {
    console.log(
      "Existing matching records will NOT be updated."
    );
  }
}

console.log(
  "==============================================\n"
);


// ============================================================
// Utility Functions
// ============================================================

/**
 * Return true when a value is empty.
 *
 * We treat null, undefined, and blank strings as empty.
 */
function isEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  );
}


/**
 * Convert a value to a trimmed string.
 *
 * Empty values become an empty string.
 */
function stringValue(value) {
  if (isEmpty(value)) {
    return "";
  }

  return String(value).trim();
}


/**
 * Convert YAML tags into an array.
 *
 * The YAML file normally contains an array, but this
 * function also handles a single string safely.
 */
function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => stringValue(tag))
      .filter(Boolean);
  }

  if (!isEmpty(tags)) {
    return [stringValue(tags)];
  }

  return [];
}


/**
 * Normalize a term for comparison.
 *
 * This is ONLY used for matching existing records.
 *
 * It does not modify the actual term stored in Notion.
 */
function normalizeTerm(term) {
  return stringValue(term).toLowerCase();
}


/**
 * Pause execution.
 *
 * A small delay helps keep requests conservative.
 */
function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}


// ============================================================
// Notion Request Helper
// ============================================================

/**
 * Make a request to the Notion API.
 *
 * This centralizes authentication and error handling.
 */
async function notionRequest(
  endpoint,
  options = {}
) {
  const response =
    await fetch(
      `${NOTION_API_BASE_URL}${endpoint}`,
      {
        ...options,

        headers: {
          Authorization:
            `Bearer ${notionToken}`,

          "Notion-Version":
            NOTION_VERSION,

          "Content-Type":
            "application/json",

          ...(options.headers || {}),
        },
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    throw new Error(
      [
        `Notion API request failed.`,
        `HTTP status: ${response.status}`,
        `Endpoint: ${endpoint}`,
        "",
        JSON.stringify(
          data,
          null,
          2
        ),
      ].join("\n")
    );
  }

  return data;
}


// ============================================================
// Load YAML
// ============================================================

/**
 * Read the existing vocabulary YAML file.
 */
function loadVocabulary() {
  console.log(
    "Loading vocabulary YAML..."
  );

  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(
      `Vocabulary file not found: ${DATA_PATH}`
    );
  }

  const fileContents =
    fs.readFileSync(
      DATA_PATH,
      "utf8"
    );

  const vocabulary =
    yaml.load(fileContents);

  if (!Array.isArray(vocabulary)) {
    throw new Error(
      [
        "Expected _data/vocabulary.yml",
        "to contain a YAML array of vocabulary records.",
      ].join("\n")
    );
  }

  console.log(
    `Loaded ${vocabulary.length} vocabulary records.\n`
  );

  return vocabulary;
}


// ============================================================
// Validate YAML Records
// ============================================================

/**
 * Validate the vocabulary before doing anything with Notion.
 *
 * This catches duplicate terms and missing terms before the
 * migration can create unwanted records.
 */
function validateVocabulary(
  vocabulary
) {
  console.log(
    "Validating vocabulary..."
  );

  const seenTerms =
    new Map();

  const requiredFields = [
    "term",
  ];

  for (
    let index = 0;
    index < vocabulary.length;
    index++
  ) {
    const entry =
      vocabulary[index];

    for (
      const field of requiredFields
    ) {
      if (
        isEmpty(
          entry?.[field]
        )
      ) {
        throw new Error(
          `Vocabulary record #${index + 1} is missing required field "${field}".`
        );
      }
    }

    const term =
      stringValue(
        entry.term
      );

    const normalized =
      normalizeTerm(term);

    if (
      seenTerms.has(normalized)
    ) {
      throw new Error(
        [
          "Duplicate vocabulary term detected.",
          "",
          `Term: ${term}`,
          `Previous record: ${seenTerms.get(normalized)}`,
          `Current record: ${index + 1}`,
        ].join("\n")
      );
    }

    seenTerms.set(
      normalized,
      index + 1
    );
  }

  console.log(
    "✓ Vocabulary validation passed.\n"
  );
}


// ============================================================
// Fetch Notion Data Source
// ============================================================

/**
 * Fetch the Vocabulary data source.
 *
 * This gives us two useful pieces of information:
 *
 * 1. Confirmation that the integration can access it.
 * 2. The actual Notion property configuration.
 */
async function fetchDataSource() {
  console.log(
    "Checking Notion data source..."
  );

  const data =
    await notionRequest(
      `/data_sources/${notionDataSourceId}`,
      {
        method: "GET",
      }
    );

  console.log(
    `✓ Connected to Notion data source: ${getDataSourceTitle(data)}`
  );

  return data;
}


/**
 * Extract the data source title.
 */
function getDataSourceTitle(
  dataSource
) {
  return (
    dataSource.title
      ?.map(
        (item) =>
          item.plain_text
      )
      .join("") ||
    "Untitled"
  );
}


// ============================================================
// Validate Notion Schema
// ============================================================

/**
 * Make sure the Notion database contains the properties
 * our migration expects.
 *
 * We intentionally validate instead of silently creating
 * or renaming database properties.
 */
function validateNotionSchema(
  dataSource
) {
  console.log(
    "\nChecking Notion property schema..."
  );

  const properties =
    dataSource.properties || {};

  const expectedProperties = {
    "Term": "title",
    "Source Preference": "select",
    "Short Definition": "rich_text",
    "Part of Speech": "select",
    "Etymology": "rich_text",
    "Source": "select",
    "URL": "url",
    "Tags": "multi_select",
  };

  for (
    const [
      propertyName,
      expectedType,
    ] of Object.entries(
      expectedProperties
    )
  ) {
    const property =
      properties[propertyName];

    if (!property) {
      throw new Error(
        [
          `Notion property "${propertyName}" was not found.`,
          "",
          `Expected type: ${expectedType}`,
        ].join("\n")
      );
    }

    if (
      property.type !==
      expectedType
    ) {
      throw new Error(
        [
          `Notion property "${propertyName}" has the wrong type.`,
          "",
          `Expected: ${expectedType}`,
          `Found: ${property.type}`,
        ].join("\n")
      );
    }
  }

  console.log(
    "✓ Notion property schema looks correct.\n"
  );
}


// ============================================================
// Fetch Existing Notion Pages
// ============================================================

/**
 * Fetch all pages from the Vocabulary data source.
 *
 * Notion returns records in pages, so we continue until
 * has_more is false.
 */
async function fetchExistingPages() {
  console.log(
    "Fetching existing Vocabulary records from Notion..."
  );

  const pages = [];

  let startCursor =
    undefined;

  while (true) {
    const body = {
      page_size: 100,
    };

    if (startCursor) {
      body.start_cursor =
        startCursor;
    }

    const data =
      await notionRequest(
        `/data_sources/${notionDataSourceId}/query`,
        {
          method: "POST",

          body:
            JSON.stringify(body),
        }
      );

    if (
      Array.isArray(
        data.results
      )
    ) {
      pages.push(
        ...data.results
      );
    }

    if (
      !data.has_more
    ) {
      break;
    }

    startCursor =
      data.next_cursor;

    if (!startCursor) {
      break;
    }
  }

  console.log(
    `✓ Found ${pages.length} existing Notion record(s).\n`
  );

  return pages;
}


// ============================================================
// Extract Notion Term
// ============================================================

/**
 * Get the Term value from an existing Notion page.
 */
function getNotionPageTerm(
  page
) {
  const property =
    page.properties?.Term;

  if (
    !property ||
    property.type !== "title"
  ) {
    return "";
  }

  return (
    property.title
      ?.map(
        (item) =>
          item.plain_text
      )
      .join("") ||
    ""
  );
}


// ============================================================
// Build Existing Record Map
// ============================================================

/**
 * Build a lookup map:
 *
 * normalized term → Notion page
 *
 * This makes matching existing records fast and
 * case-insensitive.
 */
function buildExistingRecordMap(
  pages
) {
  const map =
    new Map();

  for (
    const page of pages
  ) {
    const term =
      getNotionPageTerm(page);

    if (
      isEmpty(term)
    ) {
      continue;
    }

    const normalized =
      normalizeTerm(term);

    if (
      map.has(normalized)
    ) {
      console.warn(
        `⚠️ Duplicate Term already exists in Notion: "${term}"`
      );
    }

    map.set(
      normalized,
      page
    );
  }

  return map;
}


// ============================================================
// Convert YAML to Notion Properties
// ============================================================

/**
 * Create the Notion property payload for a vocabulary
 * record.
 *
 * The values here are copied from the YAML record.
 *
 * We are NOT enriching or correcting the vocabulary during
 * this migration.
 */
function buildNotionProperties(
  entry
) {
  const properties = {};

  // ----------------------------------------------------------
  // Term
  // ----------------------------------------------------------

  properties.Term = {
    title: [
      {
        type: "text",

        text: {
          content:
            stringValue(
              entry.term
            ),
        },
      },
    ],
  };


  // ----------------------------------------------------------
  // Source Preference
  // ----------------------------------------------------------

  if (
    !isEmpty(
      entry.source_preference
    )
  ) {
    properties[
      "Source Preference"
    ] = {
      select: {
        name:
          stringValue(
            entry.source_preference
          ),
      },
    };
  }


  // ----------------------------------------------------------
  // Short Definition
  // ----------------------------------------------------------

  if (
    !isEmpty(
      entry.short_definition
    )
  ) {
    properties[
      "Short Definition"
    ] = {
      rich_text: [
        {
          type: "text",

          text: {
            content:
              stringValue(
                entry.short_definition
              ),
          },
        },
      ],
    };
  }


  // ----------------------------------------------------------
  // Part of Speech
  // ----------------------------------------------------------

  if (
    !isEmpty(
      entry.part_of_speech
    )
  ) {
    properties[
      "Part of Speech"
    ] = {
      select: {
        name:
          stringValue(
            entry.part_of_speech
          ),
      },
    };
  }


  // ----------------------------------------------------------
  // Etymology
  // ----------------------------------------------------------

  if (
    !isEmpty(
      entry.etymology
    )
  ) {
    properties.Etymology = {
      rich_text: [
        {
          type: "text",

          text: {
            content:
              stringValue(
                entry.etymology
              ),
          },
        },
      ],
    };
  }


  // ----------------------------------------------------------
  // Source
  // ----------------------------------------------------------

  if (
    !isEmpty(
      entry.source
    )
  ) {
    properties.Source = {
      select: {
        name:
          stringValue(
            entry.source
          ),
      },
    };
  }


  // ----------------------------------------------------------
  // URL
  // ----------------------------------------------------------

  if (
    !isEmpty(
      entry.url
    )
  ) {
    properties.URL = {
      url:
        stringValue(
          entry.url
        ),
    };
  }


  // ----------------------------------------------------------
  // Tags
  // ----------------------------------------------------------

  const tags =
    normalizeTags(
      entry.tags
    );

  if (
    tags.length > 0
  ) {
    properties.Tags = {
      multi_select:
        tags.map(
          (tag) => ({
            name: tag,
          })
        ),
    };
  }


  return properties;
}


// ============================================================
// Preview Helpers
// ============================================================

/**
 * Describe a vocabulary record for console output.
 */
function describeEntry(
  entry
) {
  return {
    term:
      stringValue(
        entry.term
      ),

    source_preference:
      stringValue(
        entry.source_preference
      ),

    part_of_speech:
      stringValue(
        entry.part_of_speech
      ),

    source:
      stringValue(
        entry.source
      ),

    tags:
      normalizeTags(
        entry.tags
      ),
  };
}


// ============================================================
// Create Notion Page
// ============================================================

/**
 * Create one vocabulary page in Notion.
 */
async function createNotionPage(
  entry
) {
  const properties =
    buildNotionProperties(
      entry
    );

  const body = {
    parent: {
      data_source_id:
        notionDataSourceId,
    },

    properties,
  };

  return notionRequest(
    "/pages",
    {
      method: "POST",

      body:
        JSON.stringify(body),
    }
  );
}


// ============================================================
// Update Existing Notion Page
// ============================================================

/**
 * Update an existing vocabulary page.
 *
 * This is ONLY called when the user explicitly supplies:
 *
 *     --update-existing
 */
async function updateNotionPage(
  pageId,
  entry
) {
  const properties =
    buildNotionProperties(
      entry
    );

  return notionRequest(
    `/pages/${pageId}`,
    {
      method: "PATCH",

      body:
        JSON.stringify({
          properties,
        }),
    }
  );
}


// ============================================================
// Migration
// ============================================================

/**
 * Perform the migration.
 *
 * This function first determines what should happen to every
 * YAML record before making any writes.
 *
 * That means preview mode and write mode use the same
 * decision-making logic.
 */
async function migrate(
  vocabulary,
  existingPages
) {
  const existingMap =
    buildExistingRecordMap(
      existingPages
    );

  let created = 0;
  let wouldCreate = 0;

  let skipped = 0;

  let updated = 0;
  let wouldUpdate = 0;

  let failed = 0;

  console.log(
    "=============================================="
  );

  console.log(
    "MIGRATION PLAN"
  );

  console.log(
    "==============================================\n"
  );


  // ----------------------------------------------------------
  // First pass: display the plan
  // ----------------------------------------------------------

  for (
    const entry of vocabulary
  ) {
    const term =
      stringValue(
        entry.term
      );

    const normalized =
      normalizeTerm(term);

    const existing =
      existingMap.get(
        normalized
      );

    if (!existing) {
      console.log(
        `CREATE: ${term}`
      );

      wouldCreate++;

      continue;
    }

    const existingTerm =
      getNotionPageTerm(
        existing
      );

    if (
      updateExisting
    ) {
      console.log(
        `UPDATE: ${term} (existing: "${existingTerm}")`
      );

      wouldUpdate++;
    } else {
      console.log(
        `SKIP:   ${term} (already exists)`
      );

      skipped++;
    }
  }


  // ----------------------------------------------------------
  // Preview mode stops here.
  // ----------------------------------------------------------

  if (
    previewMode
  ) {
    console.log(
      "\n=============================================="
    );

    console.log(
      "PREVIEW SUMMARY"
    );

    console.log(
      "=============================================="
    );

    console.log(
      `Records in YAML:       ${vocabulary.length}`
    );

    console.log(
      `Would create:          ${wouldCreate}`
    );

    console.log(
      `Would update:          ${wouldUpdate}`
    );

    console.log(
      `Would skip:             ${skipped}`
    );

    console.log(
      "\nNo changes were made to Notion."
    );

    return;
  }


  // ----------------------------------------------------------
  // Second pass: perform writes
  // ----------------------------------------------------------

  console.log(
    "\n=============================================="
  );

  console.log(
    "WRITING TO NOTION"
  );

  console.log(
    "==============================================\n"
  );


  for (
    const entry of vocabulary
  ) {
    const term =
      stringValue(
        entry.term
      );

    const normalized =
      normalizeTerm(term);

    const existing =
      existingMap.get(
        normalized
      );


    // --------------------------------------------------------
    // Create new record
    // --------------------------------------------------------

    if (!existing) {
      try {
        console.log(
          `Creating: ${term}`
        );

        await createNotionPage(
          entry
        );

        created++;

        console.log(
          `✓ Created: ${term}`
        );

      } catch (error) {
        failed++;

        console.error(
          `✗ Failed to create "${term}"`
        );

        console.error(
          error.message
        );
      }

      /*
       * Small delay between writes.
       */
      await sleep(300);

      continue;
    }


    // --------------------------------------------------------
    // Skip existing record
    // --------------------------------------------------------

    if (
      !updateExisting
    ) {
      continue;
    }


    // --------------------------------------------------------
    // Update existing record
    // --------------------------------------------------------

    try {
      console.log(
        `Updating: ${term}`
      );

      await updateNotionPage(
        existing.id,
        entry
      );

      updated++;

      console.log(
        `✓ Updated: ${term}`
      );

    } catch (error) {
      failed++;

      console.error(
        `✗ Failed to update "${term}"`
      );

      console.error(
        error.message
      );
    }

    /*
     * Small delay between writes.
     */
    await sleep(300);
  }


  // ----------------------------------------------------------
  // Final summary
  // ----------------------------------------------------------

  console.log(
    "\n=============================================="
  );

  console.log(
    "MIGRATION COMPLETE"
  );

  console.log(
    "=============================================="
  );

  console.log(
    `Records in YAML:       ${vocabulary.length}`
  );

  console.log(
    `Created:               ${created}`
  );

  console.log(
    `Updated:               ${updated}`
  );

  console.log(
    `Skipped:               ${skipped}`
  );

  console.log(
    `Failed:                ${failed}`
  );

  console.log(
    "=============================================="
  );
}


// ============================================================
// Main
// ============================================================

async function main() {
  /*
   * 1. Load YAML.
   */
  const vocabulary =
    loadVocabulary();


  /*
   * 2. Validate YAML before contacting Notion.
   */
  validateVocabulary(
    vocabulary
  );


  /*
   * 3. Confirm Notion access.
   */
  const dataSource =
    await fetchDataSource();


  /*
   * 4. Confirm the Notion schema.
   */
  validateNotionSchema(
    dataSource
  );


  /*
   * 5. Retrieve existing Notion records.
   */
  const existingPages =
    await fetchExistingPages();


  /*
   * 6. Preview or perform migration.
   */
  await migrate(
    vocabulary,
    existingPages
  );
}


// ============================================================
// Run
// ============================================================

main()
  .catch(
    (error) => {
      console.error(
        "\n=============================================="
      );

      console.error(
        "MIGRATION FAILED"
      );

      console.error(
        "=============================================="
      );

      console.error(
        error.message
      );

      process.exit(1);
    }
  );
