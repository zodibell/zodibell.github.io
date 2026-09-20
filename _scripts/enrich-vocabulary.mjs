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
 * FALLBACK BEHAVIOR
 * ============================================================
 *
 * If the preferred source does not contain the word, the
 * secondary source is tried.
 *
 * A source does not need to provide every field.
 *
 * For example, if Wikipedia provides a definition but does
 * not provide an etymology, the definition may be populated
 * while Etymology remains empty.
 *
 *
 * EXISTING VALUES ARE PRESERVED
 * ============================================================
 *
 * Each property is evaluated independently.
 *
 * Example:
 *
 *   Short Definition: already exists
 *   Part of Speech: empty
 *   Etymology: empty
 *
 * The script will NOT change Short Definition.
 *
 * It may populate Part of Speech and Etymology.
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
 *
 * The word is appended to this URL after being URL encoded.
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
 *
 * Wikipedia may reject requests without a descriptive
 * User-Agent.
 */
const USER_AGENT =
  "ZodiBellVocabularyEnrichment/1.0 (https://zodibell.github.io/)";


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
 * The enrichment script validates the schema before making
 * any changes.
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
 * Pause between external API requests.
 *
 * A short delay helps avoid sending requests too quickly.
 */
function sleep(milliseconds) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
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
 *   - parses JSON responses
 *   - provides a useful error if the request fails
 */
async function notionRequest(url, options = {}) {
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
 * This helper:
 *   - sends the request
 *   - parses JSON
 *   - returns null for a normal 404
 *   - throws for other HTTP errors
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


  /*
   * A 404 simply means that the source does not have
   * an entry. The caller can then try the fallback source.
   */
  if (response.status === 404) {
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
 * Return the plain text contained in a Notion rich_text
 * property.
 *
 * Blank rich-text fields become null.
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
 */
function getMultiSelect(property) {
  return (
    property?.multi_select
      ?.map((item) => item.name)
      .filter(Boolean) || []
  );
}


/* ============================================================
 * Notion Value Helpers
 * ============================================================
 */


/*
 * Determine whether a value should be considered empty.
 *
 * This is intentionally conservative.
 *
 * Empty strings and null/undefined values are considered empty.
 * Arrays are considered empty when they contain no values.
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


/*
 * Convert a string into a Notion rich_text property value.
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
 * Convert a string into a Notion select property value.
 */
function selectProperty(value) {
  return {
    select: {
      name: value,
    },
  };
}


/*
 * Convert a string into a Notion URL property value.
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
 * Convert a Notion page into a simple object used by the
 * enrichment process.
 */
function pageToVocabularyRecord(page) {
  const properties =
    page.properties;


  const term =
    getTitle(properties["Term"]);


  return {
    id: page.id,

    term,

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
 * FreeDictionaryAPI
 * ============================================================
 */


/*
 * Fetch a vocabulary entry from FreeDictionaryAPI.com.
 *
 * Returns:
 *
 *   {
 *     short_definition,
 *     part_of_speech,
 *     etymology,
 *     source,
 *     url
 *   }
 *
 * or null when the word cannot be found.
 */
async function lookupFreeDictionary(term) {
  const encodedTerm =
    encodeURIComponent(term);


  const url =
    `${FREE_DICTIONARY_URL}/${encodedTerm}`;


  const data =
    await externalRequest(url);


  if (!data) {
    return null;
  }


  /*
   * The API normally returns an array of entries.
   */
  const entries =
    Array.isArray(data)
      ? data
      : data?.entries;


  if (
    !Array.isArray(entries) ||
    entries.length === 0
  ) {
    return null;
  }


  /*
   * Use the first usable entry.
   */
  const entry =
    entries.find(Boolean);


  if (!entry) {
    return null;
  }


  /*
   * Find the first definition available in the entry.
   */
  let definition = null;
  let partOfSpeech = null;
  let etymology = null;


  /*
   * Some API responses place meanings directly on the
   * entry while others use a meanings array.
   */
  const meanings =
    entry.meanings ||
    entry.senses ||
    [];


  if (Array.isArray(meanings)) {
    for (const meaning of meanings) {
      if (
        !partOfSpeech &&
        meaning?.partOfSpeech
      ) {
        partOfSpeech =
          meaning.partOfSpeech;
      }


      const definitions =
        meaning?.definitions ||
        meaning?.senses ||
        [];


      if (
        !definition &&
        Array.isArray(definitions)
      ) {
        for (const item of definitions) {
          const candidate =
            item?.definition ||
            item?.gloss ||
            item?.text;


          if (candidate) {
            definition =
              candidate;

            break;
          }
        }
      }


      if (
        !etymology &&
        meaning?.etymology
      ) {
        etymology =
          meaning.etymology;
      }
    }
  }


  /*
   * Some responses may provide these values directly.
   */
  if (
    !partOfSpeech &&
    entry.partOfSpeech
  ) {
    partOfSpeech =
      entry.partOfSpeech;
  }


  if (
    !etymology &&
    entry.etymology
  ) {
    etymology =
      entry.etymology;
  }


  if (
    !definition &&
    entry.definition
  ) {
    definition =
      entry.definition;
  }


  /*
   * The API's entry URL is preferred when available.
   * Otherwise use the API lookup URL.
   */
  const sourceUrl =
    entry.url ||
    url;


  /*
   * Return null if the source did not actually provide
   * anything useful.
   */
  if (
    !definition &&
    !partOfSpeech &&
    !etymology
  ) {
    return null;
  }


  return {
    short_definition:
      definition || null,

    part_of_speech:
      partOfSpeech || null,

    etymology:
      etymology || null,

    source:
      "FreeDictionaryAPI.com",

    url:
      sourceUrl,
  };
}


/* ============================================================
 * Wikipedia
 * ============================================================
 */


/*
 * Fetch a vocabulary entry from Wikipedia.
 *
 * Wikipedia does not normally provide a structured
 * part-of-speech or etymology field, so this lookup supplies:
 *
 *   Short Definition
 *   Source
 *   URL
 *
 * The Wikipedia summary is used as the short definition.
 */
async function lookupWikipedia(term) {
  const encodedTerm =
    encodeURIComponent(
      term.replace(/\s+/g, "_")
    );


  const url =
    `${WIKIPEDIA_URL}/${encodedTerm}`;


  const data =
    await externalRequest(url);


  if (!data) {
    return null;
  }


  /*
   * Wikipedia's REST summary endpoint provides:
   *
   *   extract
   *   content_urls
   *   title
   */
  const definition =
    data.extract ||
    null;


  const sourceUrl =
    data?.content_urls?.desktop?.page ||
    data?.content_urls?.mobile?.page ||
    null;


  if (!definition) {
    return null;
  }


  return {
    short_definition:
      definition,

    /*
     * Wikipedia's summary endpoint does not reliably provide
     * a structured part of speech.
     */
    part_of_speech:
      null,

    /*
     * Wikipedia is not used to populate etymology here.
     */
    etymology:
      null,

    source:
      "Wikipedia.org",

    url:
      sourceUrl,
  };
}


/* ============================================================
 * Source Lookup
 * ============================================================
 */


/*
 * Look up a term using the user's preferred source first.
 *
 * Returns:
 *
 *   {
 *     data,
 *     source
 *   }
 *
 * or null when neither source has a usable entry.
 */
async function lookupTerm(
  term,
  sourcePreference
) {
  const preference =
    String(
      sourcePreference || "dictionary"
    )
      .trim()
      .toLowerCase();


  let firstSource;
  let secondSource;


  if (
    preference === "wikipedia"
  ) {
    firstSource =
      "wikipedia";

    secondSource =
      "dictionary";
  } else {
    /*
     * Treat "dictionary" as the default.
     *
     * This also provides a sensible fallback for an empty
     * or unexpected Source Preference value.
     */
    firstSource =
      "dictionary";

    secondSource =
      "wikipedia";
  }


  /*
   * Try the preferred source.
   */
  if (
    firstSource === "wikipedia"
  ) {
    try {
      const data =
        await lookupWikipedia(term);


      if (data) {
        return {
          data,
          source: "wikipedia",
        };
      }
    } catch (error) {
      console.log(
        `    Wikipedia lookup failed: ${error.message}`
      );
    }
  } else {
    try {
      const data =
        await lookupFreeDictionary(term);


      if (data) {
        return {
          data,
          source: "dictionary",
        };
      }
    } catch (error) {
      console.log(
        `    FreeDictionaryAPI lookup failed: ${error.message}`
      );
    }
  }


  /*
   * Try the fallback source.
   */
  console.log(
    `    Preferred source had no usable entry; trying fallback...`
  );


  if (
    secondSource === "wikipedia"
  ) {
    try {
      const data =
        await lookupWikipedia(term);


      if (data) {
        return {
          data,
          source: "wikipedia",
        };
      }
    } catch (error) {
      console.log(
        `    Wikipedia fallback failed: ${error.message}`
      );
    }
  } else {
    try {
      const data =
        await lookupFreeDictionary(term);


      if (data) {
        return {
          data,
          source: "dictionary",
        };
      }
    } catch (error) {
      console.log(
        `    FreeDictionaryAPI fallback failed: ${error.message}`
      );
    }
  }


  return null;
}


/* ============================================================
 * Build Proposed Changes
 * ============================================================
 */


/*
 * Compare an existing Notion record with the data returned
 * by an external source.
 *
 * Only EMPTY Notion fields are included in the proposed
 * changes.
 *
 * Existing values are never replaced.
 */
function buildChanges(
  record,
  enrichment
) {
  const changes = {};


  if (
    isEmpty(record.short_definition) &&
    !isEmpty(enrichment.short_definition)
  ) {
    changes["Short Definition"] =
      richTextProperty(
        enrichment.short_definition
      );
  }


  if (
    isEmpty(record.part_of_speech) &&
    !isEmpty(enrichment.part_of_speech)
  ) {
    changes["Part of Speech"] =
      selectProperty(
        enrichment.part_of_speech
      );
  }


  if (
    isEmpty(record.etymology) &&
    !isEmpty(enrichment.etymology)
  ) {
    changes["Etymology"] =
      richTextProperty(
        enrichment.etymology
      );
  }


  if (
    isEmpty(record.source) &&
    !isEmpty(enrichment.source)
  ) {
    changes["Source"] =
      selectProperty(
        enrichment.source
      );
  }


  if (
    isEmpty(record.url) &&
    !isEmpty(enrichment.url)
  ) {
    changes["URL"] =
      urlProperty(
        enrichment.url
      );
  }


  return changes;
}


/*
 * Return the human-readable names of the fields that will
 * be updated.
 */
function changedPropertyNames(changes) {
  return Object.keys(changes);
}


/* ============================================================
 * Update Notion Page
 * ============================================================
 */


/*
 * Update one Notion vocabulary page.
 *
 * This function is called only in write mode.
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
   * A vocabulary record without a Term cannot be enriched.
   */
  if (!record.term) {
    console.log(
      "  ⚠ Skipped: record has no Term."
    );

    noMatchCount++;

    continue;
  }


  /*
   * Determine which fields are currently missing.
   */
  const missingFields = [];


  if (
    isEmpty(record.short_definition)
  ) {
    missingFields.push(
      "Short Definition"
    );
  }


  if (
    isEmpty(record.part_of_speech)
  ) {
    missingFields.push(
      "Part of Speech"
    );
  }


  if (
    isEmpty(record.etymology)
  ) {
    missingFields.push(
      "Etymology"
    );
  }


  if (
    isEmpty(record.source)
  ) {
    missingFields.push(
      "Source"
    );
  }


  if (
    isEmpty(record.url)
  ) {
    missingFields.push(
      "URL"
    );
  }


  /*
   * If every enrichable field already has a value,
   * there is nothing to do.
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


  let lookup;


  try {
    lookup =
      await lookupTerm(
        record.term,
        record.source_preference
      );
  } catch (error) {
    console.log(
      `  ⚠ Lookup error: ${error.message}`
    );

    errorCount++;

    continue;
  }


  /*
   * No source contained a usable entry.
   */
  if (!lookup) {
    console.log(
      "  ⚠ No usable entry found."
    );

    noMatchCount++;

    /*
     * Pause before moving to the next word.
     */
    await sleep(300);

    continue;
  }


  /*
   * Record whether the fallback source was used.
   */
  const preferredSource =
    String(
      record.source_preference || "dictionary"
    )
      .trim()
      .toLowerCase();


  const actualSource =
    lookup.source;


  const usedFallback =
    (
      preferredSource === "wikipedia" &&
      actualSource === "dictionary"
    ) ||
    (
      preferredSource !== "wikipedia" &&
      actualSource === "wikipedia"
    );


  if (usedFallback) {
    console.log(
      `  ⚠ Using fallback source: ${lookup.data.source}`
    );

    fallbackCount++;
  } else {
    console.log(
      `  ✓ Source found: ${lookup.data.source}`
    );
  }


  /*
   * Determine exactly which empty fields can be filled.
   */
  const changes =
    buildChanges(
      record,
      lookup.data
    );


  const changedFields =
    changedPropertyNames(changes);


  /*
   * The source may have an entry but may not provide any
   * of the fields that are currently missing.
   */
  if (
    changedFields.length === 0
  ) {
    console.log(
      "  ⚠ Source found, but it did not provide any additional missing fields."
    );

    noMatchCount++;

    await sleep(300);

    continue;
  }


  console.log(
    `  Proposed changes: ${changedFields.join(", ")}`
  );


  /*
   * In preview mode, show the values that would be written
   * without changing Notion.
   */
  if (PREVIEW) {
    if (
      changes["Short Definition"]
    ) {
      console.log(
        `    Short Definition: ${lookup.data.short_definition}`
      );
    }


    if (
      changes["Part of Speech"]
    ) {
      console.log(
        `    Part of Speech: ${lookup.data.part_of_speech}`
      );
    }


    if (
      changes["Etymology"]
    ) {
      console.log(
        `    Etymology: ${lookup.data.etymology}`
      );
    }


    if (
      changes["Source"]
    ) {
      console.log(
        `    Source: ${lookup.data.source}`
      );
    }


    if (
      changes["URL"]
    ) {
      console.log(
        `    URL: ${lookup.data.url}`
      );
    }


    enrichedCount++;

    updatedFieldCount +=
      changedFields.length;


    await sleep(300);

    continue;
  }


  /*
   * WRITE MODE
   *
   * Only the empty fields represented in `changes` are sent
   * to Notion.
   *
   * Existing fields are not included in the PATCH request.
   */
  try {
    await updateNotionPage(
      record.id,
      changes
    );


    console.log(
      `  ✓ Updated Notion: ${changedFields.join(", ")}`
    );


    enrichedCount++;

    updatedFieldCount +=
      changedFields.length;
  } catch (error) {
    console.log(
      `  ⚠ Failed to update Notion: ${error.message}`
    );

    errorCount++;
  }


  /*
   * Pause between records.
   */
  await sleep(500);
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
    "If the proposed changes look correct, run:"
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
