import "dotenv/config";

/*
 * Vocabulary Enrichment — Notion → External Sources → Notion
 *
 * Purpose:
 *   Enrich incomplete vocabulary records in the Notion
 *   Vocabulary database using:
 *
 *     - FreeDictionaryAPI.com
 *     - Wikipedia.org
 *
 * Notion remains the source of truth.
 *
 *
 * WORKFLOW
 * ============================================================
 *
 *   Notion
 *      ↓
 *   enrich-vocabulary.mjs
 *      ↓
 *   Fill missing fields only
 *      ↓
 *   Notion
 *      ↓
 *   export-vocabulary.mjs
 *      ↓
 *   _data/vocabulary_normalized.yml
 *      ↓
 *   Jekyll
 *
 *
 * MODES
 * ============================================================
 *
 * Preview:
 *
 *   node _scripts/enrich-vocabulary.mjs --preview
 *
 * Preview mode:
 *   - Reads vocabulary records from Notion
 *   - Looks up incomplete records
 *   - Shows proposed changes
 *   - Does NOT modify Notion
 *
 *
 * Write:
 *
 *   node _scripts/enrich-vocabulary.mjs
 *
 * Write mode:
 *   - Performs the same lookups
 *   - Updates only empty fields in Notion
 *   - Never overwrites existing values
 *
 *
 * IMPORTANT
 * ============================================================
 *
 * This script NEVER changes:
 *
 *   Term
 *   Source Preference
 *   Tags
 *
 * This script may populate these fields when they are empty:
 *
 *   Short Definition
 *   Part of Speech
 *   Etymology
 *   Source
 *   URL
 *
 *
 * FIELD-BY-FIELD ENRICHMENT
 * ============================================================
 *
 * Sources are treated as providers of individual fields.
 *
 * For example:
 *
 *   FreeDictionaryAPI
 *      → definition ✓
 *      → part of speech ✓
 *      → etymology —
 *
 *   Wikipedia
 *      → definition ✓
 *      → part of speech —
 *      → etymology —
 *
 * If a field is already populated in Notion, it is NEVER
 * overwritten.
 *
 * If the preferred source does not provide a particular field,
 * another source may be consulted for that field.
 *
 *
 * SOURCE PREFERENCE
 * ============================================================
 *
 * Source Preference controls which source is tried first.
 *
 *   dictionary
 *      → FreeDictionaryAPI.com
 *      → Wikipedia fallback
 *
 *   wikipedia
 *      → Wikipedia
 *      → FreeDictionaryAPI.com fallback
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
 */


/* ============================================================
 * Configuration
 * ============================================================
 */

const NOTION_TOKEN =
  process.env.NOTION_TOKEN;

const DATA_SOURCE_ID =
  process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;

const NOTION_VERSION =
  process.env.NOTION_VERSION || "2026-03-11";


/*
 * FreeDictionaryAPI endpoint.
 */
const FREE_DICTIONARY_URL =
  "https://freedictionaryapi.com/api/v1/entries/en";


/*
 * Wikipedia REST API endpoint.
 */
const WIKIPEDIA_URL =
  "https://en.wikipedia.org/api/rest_v1/page/summary";


/*
 * User-Agent used when contacting Wikipedia.
 */
const USER_AGENT =
  "ZodiBellVocabularyEnrichment/1.0 (https://zodibell.github.io/)";


/*
 * Delay between external API requests.
 *
 * This keeps requests polite and reduces the chance of
 * triggering rate limits.
 */
const REQUEST_DELAY =
  500;


/*
 * Preview mode is enabled when the command includes:
 *
 *   --preview
 */
const PREVIEW =
  process.argv.includes("--preview");


/*
 * Expected Notion database schema.
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
 * Pause between requests.
 */
function sleep(milliseconds) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}


/*
 * Determine whether a value is empty.
 *
 * Empty strings, null, undefined, and empty arrays are
 * considered empty.
 */
function isEmpty(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return true;
  }


  if (
    typeof value === "string"
  ) {
    return value.trim() === "";
  }


  if (
    Array.isArray(value)
  ) {
    return value.length === 0;
  }


  return false;
}


/* ============================================================
 * Notion API Helpers
 * ============================================================
 */


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
 */
async function notionRequest(
  url,
  options = {}
) {
  const response =
    await fetch(url, {
      ...options,

      headers: {
        ...notionHeaders(),
        ...(options.headers || {}),
      },
    });


  const text =
    await response.text();


  let data;


  try {
    data =
      text
        ? JSON.parse(text)
        : {};
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
 * External API Helpers
 * ============================================================
 */


/*
 * Make a request to an external JSON API.
 *
 * A 404 means that the source does not have the requested
 * entry, so null is returned.
 */
async function externalRequest(
  url,
  options = {}
) {
  const response =
    await fetch(url, {
      ...options,

      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });


  if (
    response.status === 404
  ) {
    return null;
  }


  const text =
    await response.text();


  let data;


  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    throw new Error(
      `External API returned invalid JSON (HTTP ${response.status}).`
    );
  }


  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `HTTP ${response.status}`;


    throw new Error(
      `External API error: ${message}`
    );
  }


  return data;
}


/* ============================================================
 * Notion Property Helpers
 * ============================================================
 */


/*
 * Return plain text from a Notion rich_text property.
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
 */
function getUrl(property) {
  return property?.url || null;
}


/*
 * Return title text from a Notion title property.
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
 */
function getMultiSelect(property) {
  return (
    property?.multi_select
      ?.map((item) => item.name)
      .filter(Boolean) || []
  );
}


/* ============================================================
 * Notion Update Property Helpers
 * ============================================================
 */


/*
 * Convert a string to a Notion rich_text property.
 */
function richTextProperty(value) {
  return {
    rich_text: [
      {
        type: "text",

        text: {
          content: value,
        },
      },
    ],
  };
}


/*
 * Convert a string to a Notion select property.
 */
function selectProperty(value) {
  return {
    select: {
      name: value,
    },
  };
}


/*
 * Convert a string to a Notion URL property.
 */
function urlProperty(value) {
  return {
    url: value,
  };
}


/* ============================================================
 * Convert Notion Page → Vocabulary Record
 * ============================================================
 */


/*
 * Convert one Notion page into the structure used by the
 * enrichment process.
 */
function pageToVocabularyRecord(page) {
  const properties =
    page.properties;


  return {
    id: page.id,

    term:
      getTitle(
        properties["Term"]
      ),

    source_preference:
      getSelect(
        properties["Source Preference"]
      ),

    short_definition:
      getRichText(
        properties["Short Definition"]
      ),

    part_of_speech:
      getSelect(
        properties["Part of Speech"]
      ),

    etymology:
      getRichText(
        properties["Etymology"]
      ),

    source:
      getSelect(
        properties["Source"]
      ),

    url:
      getUrl(
        properties["URL"]
      ),

    tags:
      getMultiSelect(
        properties["Tags"]
      ),
  };
}


/* ============================================================
 * FreeDictionaryAPI Helpers
 * ============================================================
 */


/*
 * Recursively search an object for a property.
 *
 * This makes the parser more tolerant of changes in the
 * API's response structure.
 */
function findFirstValue(
  value,
  propertyNames
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  if (
    Array.isArray(value)
  ) {
    for (const item of value) {
      const result =
        findFirstValue(
          item,
          propertyNames
        );


      if (!isEmpty(result)) {
        return result;
      }
    }


    return null;
  }


  if (
    typeof value !== "object"
  ) {
    return null;
  }


  for (
    const propertyName
    of propertyNames
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        value,
        propertyName
      )
    ) {
      const candidate =
        value[propertyName];


      if (
        typeof candidate === "string" &&
        candidate.trim()
      ) {
        return candidate.trim();
      }
    }
  }


  for (
    const child
    of Object.values(value)
  ) {
    const result =
      findFirstValue(
        child,
        propertyNames
      );


    if (!isEmpty(result)) {
      return result;
    }
  }


  return null;
}


/*
 * Extract the first useful definition from a
 * FreeDictionaryAPI response.
 */
function extractDictionaryDefinition(data) {
  return findFirstValue(
    data,
    [
      "definition",
      "gloss",
    ]
  );
}


/*
 * Extract the first part of speech from a
 * FreeDictionaryAPI response.
 */
function extractDictionaryPartOfSpeech(data) {
  return findFirstValue(
    data,
    [
      "partOfSpeech",
      "part_of_speech",
      "pos",
    ]
  );
}


/*
 * Extract the first etymology from a
 * FreeDictionaryAPI response.
 *
 * The API may expose this under several possible names,
 * depending on the response structure/version.
 */
function extractDictionaryEtymology(data) {
  return findFirstValue(
    data,
    [
      "etymology",
      "origin",
      "etymon",
    ]
  );
}


/*
 * Extract a useful URL from a dictionary response.
 */
function extractDictionaryUrl(
  data,
  fallbackUrl
) {
  const apiUrl =
    findFirstValue(
      data,
      [
        "url",
        "sourceUrl",
      ]
    );


  return (
    apiUrl ||
    fallbackUrl
  );
}


/*
 * Fetch a vocabulary entry from FreeDictionaryAPI.com.
 */
async function lookupFreeDictionary(
  term
) {
  const encodedTerm =
    encodeURIComponent(term);


  const requestUrl =
    `${FREE_DICTIONARY_URL}/${encodedTerm}`;


  const data =
    await externalRequest(
      requestUrl
    );


  if (!data) {
    return null;
  }


  const definition =
    extractDictionaryDefinition(
      data
    );


  const partOfSpeech =
    extractDictionaryPartOfSpeech(
      data
    );


  const etymology =
    extractDictionaryEtymology(
      data
    );


  const url =
    extractDictionaryUrl(
      data,
      requestUrl
    );


  /*
   * If the API returned an object but none of the expected
   * fields could be extracted, treat it as unusable.
   */
  if (
    !definition &&
    !partOfSpeech &&
    !etymology &&
    !url
  ) {
    return null;
  }


  return {
    short_definition:
      definition,

    part_of_speech:
      partOfSpeech,

    etymology:
      etymology,

    source:
      "FreeDictionaryAPI.com",

    url,
  };
}


/* ============================================================
 * Wikipedia Helpers
 * ============================================================
 */


/*
 * Fetch a vocabulary entry from Wikipedia.
 *
 * Wikipedia reliably provides:
 *
 *   Short Definition
 *   Source
 *   URL
 *
 * It does not reliably provide structured:
 *
 *   Part of Speech
 *   Etymology
 *
 * Therefore those fields remain null here.
 */
async function lookupWikipedia(
  term
) {
  const encodedTerm =
    encodeURIComponent(
      term.replace(
        /\s+/g,
        "_"
      )
    );


  const requestUrl =
    `${WIKIPEDIA_URL}/${encodedTerm}`;


  const data =
    await externalRequest(
      requestUrl
    );


  if (!data) {
    return null;
  }


  const definition =
    data.extract ||
    null;


  const url =
    data?.content_urls?.desktop?.page ||
    data?.content_urls?.mobile?.page ||
    null;


  if (!definition) {
    return null;
  }


  return {
    short_definition:
      definition,

    part_of_speech:
      null,

    etymology:
      null,

    source:
      "Wikipedia.org",

    url,
  };
}


/* ============================================================
 * Determine Source Order
 * ============================================================
 */


/*
 * Return the sources in the order they should be tried.
 */
function getSourceOrder(
  sourcePreference
) {
  const preference =
    String(
      sourcePreference || "dictionary"
    )
      .trim()
      .toLowerCase();


  if (
    preference === "wikipedia"
  ) {
    return [
      "wikipedia",
      "dictionary",
    ];
  }


  /*
   * Dictionary is the default.
   */
  return [
    "dictionary",
    "wikipedia",
  ];
}


/*
 * Run one source lookup.
 */
async function lookupSource(
  source,
  term
) {
  if (
    source === "wikipedia"
  ) {
    return lookupWikipedia(term);
  }


  return lookupFreeDictionary(term);
}


/* ============================================================
 * Field-by-Field Enrichment
 * ============================================================
 */


/*
 * These are the only fields that this script is allowed
 * to populate.
 */
const ENRICHABLE_FIELDS = [
  "short_definition",
  "part_of_speech",
  "etymology",
  "source",
  "url",
];


/*
 * Determine which fields are missing from a record.
 */
function getMissingFields(record) {
  return ENRICHABLE_FIELDS.filter(
    (field) =>
      isEmpty(record[field])
  );
}


/*
 * Enrich one vocabulary record.
 *
 * Each source is allowed to contribute whatever fields it
 * actually provides.
 *
 * We continue to another source whenever useful fields remain
 * missing.
 */
async function enrichRecord(
  record
) {
  const missingFields =
    getMissingFields(record);


  if (
    missingFields.length === 0
  ) {
    return {
      enrichment: {},
      sourcesUsed: [],
      missingFields: [],
    };
  }


  const enrichment = {};

  const sourcesUsed = [];

  const sourceOrder =
    getSourceOrder(
      record.source_preference
    );


  for (
    const source
    of sourceOrder
  ) {
    /*
     * Stop once every field has been supplied.
     */
    const stillMissing =
      ENRICHABLE_FIELDS.filter(
        (field) =>
          isEmpty(record[field]) &&
          isEmpty(enrichment[field])
      );


    if (
      stillMissing.length === 0
    ) {
      break;
    }


    let result;


    try {
      result =
        await lookupSource(
          source,
          record.term
        );
    } catch (error) {
      console.log(
        `    ${source} lookup failed: ${error.message}`
      );

      continue;
    }


    if (!result) {
      console.log(
        `    ${source}: no usable entry`
      );

      await sleep(
        REQUEST_DELAY
      );

      continue;
    }


    sourcesUsed.push(
      result.source
    );


    /*
     * Copy only fields that:
     *
     *   1. are missing in Notion
     *   2. have not already been supplied by another source
     *   3. actually contain a value
     */
    for (
      const field
      of ENRICHABLE_FIELDS
    ) {
      if (
        isEmpty(record[field]) &&
        isEmpty(enrichment[field]) &&
        !isEmpty(result[field])
      ) {
        enrichment[field] =
          result[field];
      }
    }


    await sleep(
      REQUEST_DELAY
    );
  }


  const remainingFields =
    ENRICHABLE_FIELDS.filter(
      (field) =>
        isEmpty(record[field]) &&
        isEmpty(enrichment[field])
    );


  return {
    enrichment,
    sourcesUsed,
    missingFields:
      remainingFields,
  };
}


/* ============================================================
 * Build Notion Changes
 * ============================================================
 */


/*
 * Convert the proposed enrichment into a Notion PATCH object.
 *
 * Only fields that were empty in the original record are
 * included.
 */
function buildChanges(
  record,
  enrichment
) {
  const changes = {};


  if (
    isEmpty(record.short_definition) &&
    !isEmpty(
      enrichment.short_definition
    )
  ) {
    changes["Short Definition"] =
      richTextProperty(
        enrichment.short_definition
      );
  }


  if (
    isEmpty(record.part_of_speech) &&
    !isEmpty(
      enrichment.part_of_speech
    )
  ) {
    changes["Part of Speech"] =
      selectProperty(
        enrichment.part_of_speech
      );
  }


  if (
    isEmpty(record.etymology) &&
    !isEmpty(
      enrichment.etymology
    )
  ) {
    changes["Etymology"] =
      richTextProperty(
        enrichment.etymology
      );
  }


  if (
    isEmpty(record.source) &&
    !isEmpty(
      enrichment.source
    )
  ) {
    changes["Source"] =
      selectProperty(
        enrichment.source
      );
  }


  if (
    isEmpty(record.url) &&
    !isEmpty(
      enrichment.url
    )
  ) {
    changes["URL"] =
      urlProperty(
        enrichment.url
      );
  }


  return changes;
}


/*
 * Return the human-readable names of changed fields.
 */
function changedPropertyNames(
  changes
) {
  return Object.keys(changes);
}


/* ============================================================
 * Update Notion
 * ============================================================
 */


/*
 * Update one Notion vocabulary page.
 *
 * This function is only called in write mode.
 */
async function updateNotionPage(
  pageId,
  properties
) {
  return notionRequest(
    `https://api.notion.com/v1/pages/${pageId}`,
    {
      method: "PATCH",

      body: JSON.stringify({
        properties,
      }),
    }
  );
}


/* ============================================================
 * Step 1: Validate Environment
 * ============================================================
 */

console.log("\n========================================");
console.log("Vocabulary Enrichment");
console.log("========================================\n");


if (PREVIEW) {
  console.log(
    "MODE: Preview (Notion will NOT be changed)\n"
  );
} else {
  console.log(
    "MODE: Write (Notion will be updated)\n"
  );
}


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
  `Data source ID: ${DATA_SOURCE_ID}\n`
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
    ?.map(
      (item) =>
        item.plain_text
    )
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
  const [
    propertyName,
    expectedType
  ]
  of Object.entries(
    REQUIRED_PROPERTIES
  )
) {
  const property =
    notionProperties[propertyName];


  if (!property) {
    console.error(
      `  MISSING: ${propertyName} (expected ${expectedType})`
    );

    schemaErrors++;

    continue;
  }


  if (
    property.type !== expectedType
  ) {
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


if (
  schemaErrors > 0
) {
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
  const body = {
    page_size: 100,
  };


  if (startCursor) {
    body.start_cursor =
      startCursor;
  }


  const result =
    await notionRequest(
      `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`,
      {
        method: "POST",

        body:
          JSON.stringify(body),
      }
    );


  pages.push(
    ...(result.results || [])
  );


  if (
    !result.has_more
  ) {
    break;
  }


  startCursor =
    result.next_cursor;


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
  "\nStep 4: Preparing vocabulary records..."
);


const vocabulary =
  pages.map(
    pageToVocabularyRecord
  );


console.log(
  `Prepared ${vocabulary.length} records.`
);


/* ============================================================
 * Step 6: Enrich Vocabulary
 * ============================================================
 */

console.log(
  "\nStep 5: Enriching vocabulary..."
);


let skippedComplete = 0;
let lookupCount = 0;
let enrichedCount = 0;
let fallbackCount = 0;
let noMatchCount = 0;
let errorCount = 0;
let updatedFieldCount = 0;


for (
  let index = 0;
  index < vocabulary.length;
  index++
) {
  const record =
    vocabulary[index];


  const number =
    index + 1;


  console.log(
    `\n[${number}/${vocabulary.length}] ${record.term || "(missing Term)"}`
  );


  /*
   * A record without a Term cannot be enriched.
   */
  if (!record.term) {
    console.log(
      "  ⚠ Skipped: record has no Term."
    );

    noMatchCount++;

    continue;
  }


  const missingFields =
    getMissingFields(record);


  /*
   * Everything is already populated.
   */
  if (
    missingFields.length === 0
  ) {
    console.log(
      "  ✓ Already complete — nothing to enrich."
    );

    skippedComplete++;

    continue;
  }


  console.log(
    `  Missing: ${missingFields.join(", ")}`
  );


  console.log(
    `  Source preference: ${record.source_preference || "dictionary (default)"}`
  );


  lookupCount++;


  let result;


  try {
    result =
      await enrichRecord(
        record
      );
  } catch (error) {
    console.log(
      `  ⚠ Enrichment error: ${error.message}`
    );

    errorCount++;

    continue;
  }


  /*
   * Show which sources contributed information.
   */
  if (
    result.sourcesUsed.length > 0
  ) {
    console.log(
      `  Sources used: ${[
        ...new Set(result.sourcesUsed)
      ].join(", ")}`
    );
  }


  /*
   * If the preferred source did not supply a value but the
   * second source did, report that fallback was used.
   */
  const uniqueSources =
    [
      ...new Set(
        result.sourcesUsed
      )
    ];


  if (
    uniqueSources.length > 1
  ) {
    fallbackCount++;
  }


  const changes =
    buildChanges(
      record,
      result.enrichment
    );


  const changedFields =
    changedPropertyNames(
      changes
    );


  /*
   * Nothing could be added.
   */
  if (
    changedFields.length === 0
  ) {
    if (
      result.missingFields.length > 0
    ) {
      console.log(
        `  ⚠ Still missing: ${result.missingFields.join(", ")}`
      );
    } else {
      console.log(
        "  ✓ No additional changes needed."
      );
    }


    noMatchCount++;

    continue;
  }


  console.log(
    `  Proposed changes: ${changedFields.join(", ")}`
  );


  /*
   * Show the actual proposed values in preview mode.
   */
  if (PREVIEW) {
    if (
      changes["Short Definition"]
    ) {
      console.log(
        `    Short Definition: ${result.enrichment.short_definition}`
      );
    }


    if (
      changes["Part of Speech"]
    ) {
      console.log(
        `    Part of Speech: ${result.enrichment.part_of_speech}`
      );
    }


    if (
      changes["Etymology"]
    ) {
      console.log(
        `    Etymology: ${result.enrichment.etymology}`
      );
    }


    if (
      changes["Source"]
    ) {
      console.log(
        `    Source: ${result.enrichment.source}`
      );
    }


    if (
      changes["URL"]
    ) {
      console.log(
        `    URL: ${result.enrichment.url}`
      );
    }


    if (
      result.missingFields.length > 0
    ) {
      console.log(
        `    Still missing: ${result.missingFields.join(", ")}`
      );
    }


    enrichedCount++;

    updatedFieldCount +=
      changedFields.length;


    continue;
  }


  /* ----------------------------------------------------------
   * WRITE MODE
   * ----------------------------------------------------------
   *
   * Only empty fields are included in the PATCH request.
   *
   * Existing Notion values are never sent back as updates.
   */

  try {
    await updateNotionPage(
      record.id,
      changes
    );


    console.log(
      `  ✓ Updated Notion: ${changedFields.join(", ")}`
    );


    if (
      result.missingFields.length > 0
    ) {
      console.log(
        `    Still missing: ${result.missingFields.join(", ")}`
      );
    }


    enrichedCount++;

    updatedFieldCount +=
      changedFields.length;
  } catch (error) {
    console.log(
      `  ⚠ Failed to update Notion: ${error.message}`
    );

    errorCount++;
  }
}


/* ============================================================
 * Step 7: Summary
 * ============================================================
 */

console.log(
  "\n========================================"
);

console.log(
  "ENRICHMENT COMPLETE"
);

console.log(
  "========================================\n"
);


console.log(
  `Mode:               ${PREVIEW ? "Preview" : "Write"}`
);

console.log(
  `Records found:      ${vocabulary.length}`
);

console.log(
  `Already complete:   ${skippedComplete}`
);

console.log(
  `Records looked up:  ${lookupCount}`
);

console.log(
  `Records enriched:   ${enrichedCount}`
);

console.log(
  `Fallback used:      ${fallbackCount}`
);

console.log(
  `No usable match:    ${noMatchCount}`
);

console.log(
  `Errors:             ${errorCount}`
);

console.log(
  `Fields ${PREVIEW ? "proposed" : "updated"}: ${updatedFieldCount}`
);


if (PREVIEW) {
  console.log(
    "\nPreview mode did not modify Notion."
  );

  console.log(
    "Review the proposed changes above."
  );

  console.log(
    "If they look correct, run:"
  );

  console.log(
    "\n  node _scripts/enrich-vocabulary.mjs"
  );
} else {
  console.log(
    "\nNotion has been updated."
  );

  console.log(
    "Next step: export the enriched vocabulary to YAML:"
  );

  console.log(
    "\n  node _scripts/export-vocabulary.mjs"
  );
}


console.log("");
