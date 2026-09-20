import "dotenv/config";

/*
 * Zodi Bell — Vocabulary Enrichment
 *
 * PURPOSE
 * -------
 * Enrich vocabulary records stored in Notion by filling only fields
 * that are currently empty.
 *
 * NOTION IS THE SOURCE OF TRUTH.
 *
 * WORKFLOW
 * --------
 * 1. Add or edit vocabulary in Notion.
 * 2. Run preview mode:
 *
 *      node _scripts/enrich-vocabulary.mjs --preview
 *
 * 3. Review the proposed changes.
 * 4. If the changes look correct, run write mode:
 *
 *      node _scripts/enrich-vocabulary.mjs
 *
 * 5. Export Notion to Jekyll YAML:
 *
 *      node _scripts/export-vocabulary.mjs
 *
 * 6. Build/test Jekyll.
 *
 * SAFETY
 * ------
 * This script NEVER overwrites existing user-entered values.
 *
 * It NEVER modifies:
 *   - Term
 *   - Source Preference
 *   - Tags
 *
 * It may fill only:
 *   - Short Definition
 *   - Part of Speech
 *   - Etymology
 *   - Source
 *   - URL
 *
 * SOURCE PREFERENCE
 * -----------------
 * dictionary:
 *   1. FreeDictionaryAPI.com
 *   2. Wikipedia
 *   3. Wiktionary (etymology only)
 *
 * wikipedia:
 *   1. Wikipedia
 *   2. FreeDictionaryAPI.com
 *   3. Wiktionary (etymology only)
 *
 * WIKTIONARY
 * ----------
 * Wiktionary is used specifically to obtain etymology.
 *
 * We use MediaWiki's Parse API to retrieve rendered HTML rather
 * than attempting to parse raw Wiktionary wikitext. This lets us
 * identify the English Etymology section and avoid accidentally
 * saving:
 *
 *   - [edit] links
 *   - Etymology trees
 *   - Noun/Verb sections
 *   - References
 *   - other language sections
 *
 * PREVIEW MODE
 * ------------
 * Preview mode is completely read-only. No Notion records are changed.
 */

const PREVIEW_MODE = process.argv.includes("--preview");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;
const NOTION_VERSION = process.env.NOTION_VERSION || "2026-03-11";

const FREE_DICTIONARY_URL =
  "https://freedictionaryapi.com/api/v1/entries/en";

const WIKIPEDIA_URL =
  "https://en.wikipedia.org/api/rest_v1/page/summary";

const WIKTIONARY_API_URL =
  "https://en.wiktionary.org/w/api.php";

const WIKTIONARY_PAGE_URL =
  "https://en.wiktionary.org/wiki";

const USER_AGENT =
  "ZodiBellVocabularyEnrichment/1.0 (https://zodibell.github.io/)";

const REQUEST_DELAY = 500;

/*
 * Expected Notion schema.
 *
 * These property names and types are validated before any records
 * are processed.
 */
const EXPECTED_SCHEMA = {
  Term: "title",
  "Source Preference": "select",
  "Short Definition": "rich_text",
  "Part of Speech": "select",
  Etymology: "rich_text",
  Source: "select",
  URL: "url",
  Tags: "multi_select",
};

/* ============================================================
 * GENERAL UTILITIES
 * ============================================================
 */

function isEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSourceName(source) {
  if (!source) {
    return null;
  }

  const normalized = source.toLowerCase().trim();

  if (normalized.includes("wikipedia")) {
    return "Wikipedia.org";
  }

  if (normalized.includes("wiktionary")) {
    return "Wiktionary.org";
  }

  if (
    normalized.includes("freedictionary") ||
    normalized.includes("free dictionary")
  ) {
    return "FreeDictionaryAPI.com";
  }

  return source;
}

/*
 * Recursively search an API response for the first useful value
 * associated with one of the requested keys.
 *
 * This is intentionally generic because FreeDictionaryAPI's
 * response structure may vary between entries.
 */
function findFirstValue(value, keys) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findFirstValue(item, keys);

      if (!isEmpty(result)) {
        return result;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      !isEmpty(value[key])
    ) {
      return value[key];
    }
  }

  for (const child of Object.values(value)) {
    const result = findFirstValue(child, keys);

    if (!isEmpty(result)) {
      return result;
    }
  }

  return null;
}

/* ============================================================
 * HTTP HELPERS
 * ============================================================
 */

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${url}`
    );
  }

  return response.json();
}

/* ============================================================
 * FREEDICTIONARY API
 * ============================================================
 */

/*
 * Look up a word in FreeDictionaryAPI.
 *
 * FreeDictionaryAPI is primarily used for:
 *   - Short Definition
 *   - Part of Speech
 *
 * We intentionally do NOT depend on it for etymology.
 */
async function lookupDictionary(term) {
  const url =
    `${FREE_DICTIONARY_URL}/` +
    encodeURIComponent(term.trim());

  try {
    const data = await fetchJson(url);

    const definition = findFirstValue(data, [
      "definition",
      "definitions",
      "gloss",
      "meaning",
    ]);

    const partOfSpeech = findFirstValue(data, [
      "partOfSpeech",
      "part_of_speech",
      "pos",
    ]);

    return {
      definition:
        typeof definition === "string"
          ? definition.trim()
          : null,

      partOfSpeech:
        typeof partOfSpeech === "string"
          ? partOfSpeech.trim()
          : null,

      source: "FreeDictionaryAPI.com",
      url,
    };
  } catch (error) {
    return {
      definition: null,
      partOfSpeech: null,
      source: null,
      url: null,
      error: error.message,
    };
  }
}

/* ============================================================
 * WIKIPEDIA
 * ============================================================
 */

async function lookupWikipedia(term) {
  const url =
    `${WIKIPEDIA_URL}/` +
    encodeURIComponent(term.trim());

  try {
    const data = await fetchJson(url);

    return {
      definition:
        typeof data.extract === "string" && data.extract.trim()
          ? data.extract.trim()
          : null,

      partOfSpeech: null,

      source: "Wikipedia.org",

      url:
        typeof data.content_urls?.desktop?.page === "string"
          ? data.content_urls.desktop.page
          : `https://en.wikipedia.org/wiki/${encodeURIComponent(
              term.trim().replace(/ /g, "_")
            )}`,
    };
  } catch (error) {
    return {
      definition: null,
      partOfSpeech: null,
      source: null,
      url: null,
      error: error.message,
    };
  }
}

/* ============================================================
 * WIKTIONARY
 * ============================================================
 */

/*
 * Build a direct Wiktionary URL for the word.
 */
function buildWiktionaryUrl(term) {
  return `${WIKTIONARY_PAGE_URL}/${encodeURIComponent(
    term.trim().replace(/ /g, "_")
  )}`;
}

/*
 * Decode the most common HTML entities that may remain after
 * stripping tags.
 *
 * We deliberately keep this dependency-free.
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, number) => {
      const codePoint = Number(number);

      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hexadecimal) => {
      const codePoint = parseInt(hexadecimal, 16);

      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : "";
    });
}

/*
 * Remove HTML markup while preserving the visible text.
 *
 * Important:
 * We remove certain structural elements BEFORE stripping all tags.
 * This prevents things such as Wiktionary's edit links and
 * reference markers from leaking into the final etymology.
 */
function cleanEtymologyHtml(html) {
  if (!html) {
    return null;
  }

  let cleaned = html;

  /*
   * Remove scripts, styles, templates, and other non-visible
   * elements.
   */
  cleaned = cleaned.replace(
    /<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  /*
   * Remove Wiktionary edit links.
   *
   * Rendered MediaWiki headings commonly contain:
   *
   *   <span class="mw-editsection">...</span>
   *
   * We don't want "[edit]" or any of the surrounding markup.
   */
  cleaned = cleaned.replace(
    /<span[^>]*class=["'][^"']*mw-editsection[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    " "
  );

  /*
   * Remove edit links that may appear outside the standard
   * mw-editsection span.
   */
  cleaned = cleaned.replace(
    /<a[^>]*(?:title=["'][^"']*edit[^"']*["']|href=["'][^"']*action=edit[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi,
    " "
  );

  /*
   * Remove reference superscripts such as [1], [2], etc.
   *
   * The actual reference text is not useful in our vocabulary
   * database.
   */
  cleaned = cleaned.replace(
    /<sup[^>]*>[\s\S]*?<\/sup>/gi,
    " "
  );

  /*
   * Remove HTML tables.
   *
   * Wiktionary's "Etymology tree" is commonly rendered as a
   * table or table-like structure. The tree is useful on
   * Wiktionary itself, but the prose etymology is much more
   * appropriate for this vocabulary database.
   */
  cleaned = cleaned.replace(
    /<table[^>]*>[\s\S]*?<\/table>/gi,
    " "
  );

  /*
   * Remove common navigation / metadata blocks that should
   * never become part of the definition.
   */
  cleaned = cleaned.replace(
    /<(div|span|section)[^>]*(?:class|id)=["'][^"']*(?:mw-references-wrap|reflist|references|navbox|metadata|catlinks|printfooter|authority-control)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  /*
   * Convert block-level HTML into spaces before stripping
   * the remaining tags.
   */
  cleaned = cleaned.replace(
    /<\/(p|div|li|dd|dt|blockquote|br|h[1-6])>/gi,
    " "
  );

  /*
   * Strip all remaining HTML tags.
   */
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  /*
   * Decode HTML entities.
   */
  cleaned = decodeHtmlEntities(cleaned);

  /*
   * Remove any Wiktionary edit artifact that survived the HTML
   * cleanup.
   */
  cleaned = cleaned.replace(/\[\s*edit\s*\]/gi, "");

  /*
   * Remove bare reference markers that may have been represented
   * as text instead of superscript HTML.
   */
  cleaned = cleaned.replace(/\[\d+\]/g, "");

  /*
   * Remove common residual Etymology-tree labels.
   *
   * These are only a final safety net. The table itself should
   * already have been removed above.
   */
  cleaned = cleaned.replace(
    /\bEtymology tree\b/gi,
    ""
  );

  /*
   * Normalize whitespace.
   */
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Don't save obviously empty or malformed results.
   */
  if (!cleaned) {
    return null;
  }

  if (
    cleaned === "[edit]" ||
    cleaned.toLowerCase() === "etymology tree"
  ) {
    return null;
  }

  return cleaned;
}

/*
 * Find the English section in rendered Wiktionary HTML.
 *
 * Wiktionary normally renders language sections as h2 headings,
 * with Etymology as a lower-level heading beneath English.
 *
 * We keep this function intentionally tolerant of heading levels.
 */
function extractEnglishSection(html) {
  const headingRegex =
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

  const headings = [];
  let match;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = Number(match[1]);

    const headingText = cleanHeadingText(match[2]);

    headings.push({
      level,
      text: headingText,
      start: match.index,
      end: headingRegex.lastIndex,
    });
  }

  const englishIndex = headings.findIndex(
    (heading) =>
      heading.text.toLowerCase() === "english"
  );

  if (englishIndex === -1) {
    return null;
  }

  const englishHeading = headings[englishIndex];

  /*
   * The English section continues until the next heading of the
   * same or higher level.
   */
  let englishEnd = html.length;

  for (
    let index = englishIndex + 1;
    index < headings.length;
    index += 1
  ) {
    if (headings[index].level <= englishHeading.level) {
      englishEnd = headings[index].start;
      break;
    }
  }

  return {
    html: html.slice(
      englishHeading.end,
      englishEnd
    ),
    level: englishHeading.level,
  };
}

/*
 * Clean heading text without applying the full etymology cleanup.
 */
function cleanHeadingText(html) {
  if (!html) {
    return "";
  }

  let text = html;

  text = text.replace(
    /<span[^>]*class=["'][^"']*mw-editsection[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    ""
  );

  text = text.replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text);

  return text
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Extract ONLY the English Etymology section.
 *
 * Example:
 *
 *   English
 *     Etymology
 *       prose etymology
 *     Pronunciation
 *     Noun
 *
 * We want only:
 *
 *       prose etymology
 *
 * This is the key protection against the previous problem where
 * "truckle" continued into the Noun and Verb sections.
 */
function extractEnglishEtymologyFromHtml(html) {
  const englishSection = extractEnglishSection(html);

  if (!englishSection) {
    return null;
  }

  const englishHtml = englishSection.html;

  const headingRegex =
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

  const headings = [];
  let match;

  while ((match = headingRegex.exec(englishHtml)) !== null) {
    headings.push({
      level: Number(match[1]),
      text: cleanHeadingText(match[2]),
      start: match.index,
      end: headingRegex.lastIndex,
    });
  }

  const etymologyIndex = headings.findIndex(
    (heading) =>
      heading.text.toLowerCase() === "etymology"
  );

  if (etymologyIndex === -1) {
    return null;
  }

  const etymologyHeading = headings[etymologyIndex];

  /*
   * The Etymology section normally ends at the next heading of
   * the same or higher level.
   *
   * This means:
   *
   *   Etymology
   *   Pronunciation
   *   Noun
   *   Verb
   *
   * will stop immediately before Pronunciation.
   *
   * If there is no Pronunciation section, it will stop before
   * Noun or Verb.
   */
  let etymologyEnd = englishHtml.length;

  for (
    let index = etymologyIndex + 1;
    index < headings.length;
    index += 1
  ) {
    if (
      headings[index].level <=
      etymologyHeading.level
    ) {
      etymologyEnd = headings[index].start;
      break;
    }
  }

  const etymologyHtml = englishHtml.slice(
    etymologyHeading.end,
    etymologyEnd
  );

  return cleanEtymologyHtml(etymologyHtml);
}

/*
 * Look up a term in Wiktionary using MediaWiki's Parse API.
 *
 * We request rendered HTML because raw Wiktionary wikitext
 * contains templates such as:
 *
 *   {{borrowing}}
 *   {{etymology tree}}
 *   {{m}}
 *
 * Trying to strip those templates manually produced malformed
 * results in earlier versions of this script.
 */
async function lookupWiktionary(term) {
  const params = new URLSearchParams({
    action: "parse",
    page: term.trim(),
    prop: "text",
    format: "json",
    formatversion: "2",
  });

  const url =
    `${WIKTIONARY_API_URL}?${params.toString()}`;

  try {
    const data = await fetchJson(url);

    const html = data?.parse?.text;

    if (!html) {
      return {
        etymology: null,
        source: null,
        url: null,
        error: "No rendered page content returned.",
      };
    }

    const etymology =
      extractEnglishEtymologyFromHtml(html);

    if (!etymology) {
      return {
        etymology: null,
        source: null,
        url: null,
        error: "No usable English Etymology section found.",
      };
    }

    return {
      etymology,
      source: "Wiktionary.org",
      url: buildWiktionaryUrl(term),
    };
  } catch (error) {
    return {
      etymology: null,
      source: null,
      url: null,
      error: error.message,
    };
  }
}

/* ============================================================
 * NOTION API
 * ============================================================
 */

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionRequest(
  path,
  options = {}
) {
  const response = await fetch(
    `https://api.notion.com${path}`,
    {
      ...options,
      headers: {
        ...notionHeaders(),
        ...(options.headers || {}),
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Notion API ${response.status} ${response.statusText}: ${body}`
    );
  }

  return response.json();
}

/*
 * Retrieve the configured Notion data source.
 */
async function getDataSource() {
  return notionRequest(
    `/v1/data_sources/${DATA_SOURCE_ID}`
  );
}

/*
 * Retrieve every record in the vocabulary data source.
 *
 * Pagination is handled until Notion reports that there are
 * no more pages.
 */
async function queryDataSource() {
  const records = [];
  let startCursor = undefined;

  while (true) {
    const body = {
      page_size: 100,
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }

    const response = await notionRequest(
      `/v1/data_sources/${DATA_SOURCE_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    records.push(...(response.results || []));

    if (!response.has_more || !response.next_cursor) {
      break;
    }

    startCursor = response.next_cursor;
  }

  return records;
}

/*
 * Update a single Notion page.
 *
 * This function is only called in write mode and only after
 * buildChanges() has applied the final safety check.
 */
async function updateNotionPage(
  pageId,
  properties
) {
  return notionRequest(
    `/v1/pages/${pageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        properties,
      }),
    }
  );
}

/* ============================================================
 * NOTION PROPERTY HELPERS
 * ============================================================
 */

function getTitleValue(page, propertyName) {
  const property =
    page.properties?.[propertyName];

  if (!property || property.type !== "title") {
    return "";
  }

  return (
    property.title
      ?.map((item) => item.plain_text || "")
      .join("")
      .trim() || ""
  );
}

function getRichTextValue(
  page,
  propertyName
) {
  const property =
    page.properties?.[propertyName];

  if (!property || property.type !== "rich_text") {
    return "";
  }

  return (
    property.rich_text
      ?.map((item) => item.plain_text || "")
      .join("")
      .trim() || ""
  );
}

function getSelectValue(
  page,
  propertyName
) {
  const property =
    page.properties?.[propertyName];

  if (!property || property.type !== "select") {
    return "";
  }

  return property.select?.name?.trim() || "";
}

function getUrlValue(
  page,
  propertyName
) {
  const property =
    page.properties?.[propertyName];

  if (!property || property.type !== "url") {
    return "";
  }

  return property.url?.trim() || "";
}

/* ============================================================
 * NOTION SCHEMA VALIDATION
 * ============================================================
 */

function validateNotionSchema(dataSource) {
  const properties =
    dataSource.properties || {};

  let valid = true;

  for (const [name, expectedType] of Object.entries(
    EXPECTED_SCHEMA
  )) {
    const property = properties[name];

    if (!property) {
      console.error(
        `  ✗ ${name} — property not found`
      );

      valid = false;
      continue;
    }

    if (property.type !== expectedType) {
      console.error(
        `  ✗ ${name} — expected ${expectedType}, found ${property.type}`
      );

      valid = false;
      continue;
    }

    console.log(
      `  ✓ ${name} (${expectedType})`
    );
  }

  if (!valid) {
    throw new Error(
      "Notion schema validation failed."
    );
  }

  console.log("Schema validation passed.");
}

/* ============================================================
 * CONVERT NOTION PAGE TO INTERNAL RECORD
 * ============================================================
 */

function notionPageToRecord(page) {
  return {
    id: page.id,

    term: getTitleValue(
      page,
      "Term"
    ),

    sourcePreference:
      getSelectValue(
        page,
        "Source Preference"
      ),

    shortDefinition:
      getRichTextValue(
        page,
        "Short Definition"
      ),

    partOfSpeech:
      getSelectValue(
        page,
        "Part of Speech"
      ),

    etymology:
      getRichTextValue(
        page,
        "Etymology"
      ),

    source:
      getSelectValue(
        page,
        "Source"
      ),

    url:
      getUrlValue(
        page,
        "URL"
      ),

    tags:
      page.properties?.Tags?.multi_select
        ?.map((item) => item.name)
        .filter(Boolean) || [],
  };
}

/* ============================================================
 * ENRICHMENT HELPERS
 * ============================================================
 */

function getMissingFields(record) {
  const missing = [];

  if (isEmpty(record.shortDefinition)) {
    missing.push("short definition");
  }

  if (isEmpty(record.partOfSpeech)) {
    missing.push("part of speech");
  }

  if (isEmpty(record.etymology)) {
    missing.push("etymology");
  }

  if (isEmpty(record.source)) {
    missing.push("source");
  }

  if (isEmpty(record.url)) {
    missing.push("url");
  }

  return missing;
}

/*
 * Apply source data ONLY to fields that are currently empty.
 *
 * This function never overwrites an existing value.
 */
function applySourceResult(
  record,
  result,
  changes
) {
  if (!result) {
    return;
  }

  if (
    isEmpty(record.shortDefinition) &&
    !isEmpty(result.definition)
  ) {
    changes.shortDefinition =
      result.definition;
  }

  if (
    isEmpty(record.partOfSpeech) &&
    !isEmpty(result.partOfSpeech)
  ) {
    changes.partOfSpeech =
      result.partOfSpeech;
  }

  if (
    isEmpty(record.etymology) &&
    !isEmpty(result.etymology)
  ) {
    changes.etymology =
      result.etymology;
  }

  if (
    isEmpty(record.source) &&
    !isEmpty(result.source)
  ) {
    changes.source =
      formatSourceName(result.source);
  }

  if (
    isEmpty(record.url) &&
    !isEmpty(result.url)
  ) {
    changes.url =
      result.url;
  }
}

/*
 * Determine whether a source supplied anything useful.
 */
function sourceProvidedUsefulData(
  result,
  fields
) {
  if (!result) {
    return false;
  }

  return fields.some(
    (field) =>
      !isEmpty(result[field])
  );
}

/*
 * Enrich one vocabulary record.
 */
async function enrichRecord(record) {
  const missingBefore =
    getMissingFields(record);

  if (missingBefore.length === 0) {
    return {
      record,
      changes: {},
      sourcesUsed: [],
      fallbackUsed: false,
      errors: [],
    };
  }

  const changes = {};
  const sourcesUsed = [];
  const errors = [];

  let fallbackUsed = false;

  const preference =
    record.sourcePreference
      ?.toLowerCase()
      .trim();

  console.log(
    `\n  Missing: ${missingBefore.join(", ")}`
  );

  console.log(
    `  Source preference: ${
      preference || "(not set)"
    }`
  );

  /*
   * ----------------------------------------------------------
   * STEP 1: Definition / POS / Source / URL
   * ----------------------------------------------------------
   *
   * These fields use Dictionary and Wikipedia.
   *
   * Etymology is handled separately through Wiktionary.
   */

  const primarySource =
    preference === "wikipedia"
      ? "wikipedia"
      : "dictionary";

  const secondarySource =
    primarySource === "wikipedia"
      ? "dictionary"
      : "wikipedia";

  /*
   * Determine which fields still need a normal source lookup.
   */
  const needsDefinition =
    isEmpty(record.shortDefinition);

  const needsPartOfSpeech =
    isEmpty(record.partOfSpeech);

  const needsSource =
    isEmpty(record.source);

  const needsUrl =
    isEmpty(record.url);

  const needsNormalSource =
    needsDefinition ||
    needsPartOfSpeech ||
    needsSource ||
    needsUrl;

  let primaryResult = null;

  if (needsNormalSource) {
    if (primarySource === "dictionary") {
      primaryResult =
        await lookupDictionary(record.term);

      if (
        primaryResult.error &&
        !sourceProvidedUsefulData(
          primaryResult,
          [
            "definition",
            "partOfSpeech",
          ]
        )
      ) {
        errors.push(
          `FreeDictionaryAPI: ${primaryResult.error}`
        );
      }
    } else {
      primaryResult =
        await lookupWikipedia(record.term);

      if (
        primaryResult.error &&
        !sourceProvidedUsefulData(
          primaryResult,
          ["definition"]
        )
      ) {
        errors.push(
          `Wikipedia: ${primaryResult.error}`
        );
      }
    }

    if (
      sourceProvidedUsefulData(
        primaryResult,
        [
          "definition",
          "partOfSpeech",
        ]
      )
    ) {
      applySourceResult(
        record,
        primaryResult,
        changes
      );

      if (
        !sourcesUsed.includes(
          primaryResult.source
        )
      ) {
        sourcesUsed.push(
          primaryResult.source
        );
      }
    }
  }

  /*
   * If fields remain missing, try the fallback source.
   */
  const stillNeedsDefinition =
    isEmpty(record.shortDefinition) &&
    isEmpty(changes.shortDefinition);

  const stillNeedsPartOfSpeech =
    isEmpty(record.partOfSpeech) &&
    isEmpty(changes.partOfSpeech);

  const stillNeedsSource =
    isEmpty(record.source) &&
    isEmpty(changes.source);

  const stillNeedsUrl =
    isEmpty(record.url) &&
    isEmpty(changes.url);

  const needsFallback =
    stillNeedsDefinition ||
    stillNeedsPartOfSpeech ||
    stillNeedsSource ||
    stillNeedsUrl;

  if (needsFallback) {
    let fallbackResult;

    if (secondarySource === "dictionary") {
      fallbackResult =
        await lookupDictionary(record.term);
    } else {
      fallbackResult =
        await lookupWikipedia(record.term);
    }

    if (
      fallbackResult.error &&
      !sourceProvidedUsefulData(
        fallbackResult,
        [
          "definition",
          "partOfSpeech",
        ]
      )
    ) {
      errors.push(
        `${
          secondarySource === "dictionary"
            ? "FreeDictionaryAPI"
            : "Wikipedia"
        }: ${fallbackResult.error}`
      );
    }

    if (
      sourceProvidedUsefulData(
        fallbackResult,
        [
          "definition",
          "partOfSpeech",
        ]
      )
    ) {
      fallbackUsed = true;

      applySourceResult(
        record,
        fallbackResult,
        changes
      );

      if (
        !sourcesUsed.includes(
          fallbackResult.source
        )
      ) {
        sourcesUsed.push(
          fallbackResult.source
        );
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * STEP 2: Wiktionary etymology
   * ----------------------------------------------------------
   *
   * Wiktionary is specifically used for etymology.
   *
   * We do this independently of the source preference because
   * neither FreeDictionaryAPI nor Wikipedia is currently the
   * reliable source for this field.
   */
  if (isEmpty(record.etymology)) {
    const wiktionaryResult =
      await lookupWiktionary(record.term);

    if (
      !isEmpty(
        wiktionaryResult.etymology
      )
    ) {
      changes.etymology =
        wiktionaryResult.etymology;

      if (
        !sourcesUsed.includes(
          "Wiktionary.org"
        )
      ) {
        sourcesUsed.push(
          "Wiktionary.org"
        );
      }

      fallbackUsed = true;
    } else if (wiktionaryResult.error) {
      console.log(
        `    wiktionary: no usable entry`
      );
    }
  }

  /*
   * Report source usage.
   */
  if (sourcesUsed.length > 0) {
    console.log(
      `  Sources used: ${sourcesUsed.join(
        ", "
      )}`
    );
  } else {
    console.log(
      `  Sources used: none`
    );
  }

  /*
   * Report fallback usage separately because this is useful
   * when reviewing enrichment quality.
   */
  if (fallbackUsed) {
    console.log(
      `  Fallback/additional sources: ${sourcesUsed.join(
        ", "
      )}`
    );
  }

  /*
   * Report proposed changes.
   */
  const changeKeys =
    Object.keys(changes);

  if (changeKeys.length > 0) {
    console.log(
      `  Proposed changes:`
    );

    for (const key of changeKeys) {
      console.log(
        `    ${formatChangeLabel(
          key
        )}: ${changes[key]}`
      );
    }
  }

  /*
   * Determine which fields would still be missing after
   * enrichment.
   */
  const stillMissing = [];

  if (
    isEmpty(record.shortDefinition) &&
    isEmpty(changes.shortDefinition)
  ) {
    stillMissing.push(
      "short definition"
    );
  }

  if (
    isEmpty(record.partOfSpeech) &&
    isEmpty(changes.partOfSpeech)
  ) {
    stillMissing.push(
      "part of speech"
    );
  }

  if (
    isEmpty(record.etymology) &&
    isEmpty(changes.etymology)
  ) {
    stillMissing.push(
      "etymology"
    );
  }

  if (
    isEmpty(record.source) &&
    isEmpty(changes.source)
  ) {
    stillMissing.push(
      "source"
    );
  }

  if (
    isEmpty(record.url) &&
    isEmpty(changes.url)
  ) {
    stillMissing.push(
      "url"
    );
  }

  if (stillMissing.length > 0) {
    console.log(
      `  ⚠ Still missing: ${stillMissing.join(
        ", "
      )}`
    );
  }

  return {
    record,
    changes,
    sourcesUsed,
    fallbackUsed,
    errors,
  };
}

/*
 * Make output labels easier to read.
 */
function formatChangeLabel(key) {
  const labels = {
    shortDefinition:
      "Short Definition",

    partOfSpeech:
      "Part of Speech",

    etymology:
      "Etymology",

    source:
      "Source",

    url:
      "URL",
  };

  return labels[key] || key;
}

/* ============================================================
 * BUILD NOTION CHANGES
 * ============================================================
 */

/*
 * Convert our internal changes object into Notion properties.
 *
 * This is also the FINAL SAFETY BARRIER.
 *
 * Even if an earlier function accidentally proposes a value,
 * this function checks the ORIGINAL record and refuses to
 * update a field that wasn't empty.
 *
 * Term, Source Preference, and Tags are never included.
 */
function buildChanges(
  record,
  changes
) {
  const notionChanges = {};

  if (
    isEmpty(record.shortDefinition) &&
    !isEmpty(changes.shortDefinition)
  ) {
    notionChanges[
      "Short Definition"
    ] = {
      rich_text: [
        {
          type: "text",
          text: {
            content:
              changes.shortDefinition,
          },
        },
      ],
    };
  }

  if (
    isEmpty(record.partOfSpeech) &&
    !isEmpty(changes.partOfSpeech)
  ) {
    notionChanges[
      "Part of Speech"
    ] = {
      select: {
        name:
          changes.partOfSpeech,
      },
    };
  }

  if (
    isEmpty(record.etymology) &&
    !isEmpty(changes.etymology)
  ) {
    notionChanges.Etymology = {
      rich_text: [
        {
          type: "text",
          text: {
            content:
              changes.etymology,
          },
        },
      ],
    };
  }

  if (
    isEmpty(record.source) &&
    !isEmpty(changes.source)
  ) {
    notionChanges.Source = {
      select: {
        name:
          changes.source,
      },
    };
  }

  if (
    isEmpty(record.url) &&
    !isEmpty(changes.url)
  ) {
    notionChanges.URL = {
      url: changes.url,
    };
  }

  return notionChanges;
}

/* ============================================================
 * MAIN
 * ============================================================
 */

async function main() {
  console.log(
    "========================================"
  );
  console.log(
    "Vocabulary Enrichment"
  );
  console.log(
    "========================================"
  );
  console.log();

  console.log(
    `MODE: ${
      PREVIEW_MODE
        ? "Preview (Notion will NOT be changed)"
        : "Write (Notion WILL be updated)"
    }`
  );
  console.log();

  /*
   * ----------------------------------------------------------
   * Environment validation
   * ----------------------------------------------------------
   */
  if (!NOTION_TOKEN) {
    throw new Error(
      "Missing NOTION_TOKEN in .env"
    );
  }

  if (!DATA_SOURCE_ID) {
    throw new Error(
      "Missing NOTION_VOCABULARY_DATA_SOURCE_ID in .env"
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

  /*
   * ----------------------------------------------------------
   * Step 1: Check Notion data source
   * ----------------------------------------------------------
   */
  console.log();
  console.log(
    "Step 1: Checking Notion data source..."
  );

  const dataSource =
    await getDataSource();

  console.log(
    `Connected to: ${
      dataSource.title
        ?.map(
          (item) =>
            item.plain_text || ""
        )
        .join("") ||
      "Vocabulary"
    }`
  );

  /*
   * ----------------------------------------------------------
   * Step 2: Validate schema
   * ----------------------------------------------------------
   */
  console.log();
  console.log(
    "Step 2: Validating Notion schema..."
  );

  validateNotionSchema(
    dataSource
  );

  /*
   * ----------------------------------------------------------
   * Step 3: Fetch records
   * ----------------------------------------------------------
   */
  console.log();
  console.log(
    "Step 3: Fetching vocabulary records..."
  );

  const notionPages =
    await queryDataSource();

  console.log(
    `Found ${notionPages.length} records.`
  );

  /*
   * ----------------------------------------------------------
   * Step 4: Convert records
   * ----------------------------------------------------------
   */
  console.log();
  console.log(
    "Step 4: Preparing vocabulary records..."
  );

  const records =
    notionPages.map(
      notionPageToRecord
    );

  console.log(
    `Prepared ${records.length} records.`
  );

  /*
   * ----------------------------------------------------------
   * Step 5: Enrich records
   * ----------------------------------------------------------
   */
  console.log();
  console.log(
    "Step 5: Enriching vocabulary..."
  );

  let alreadyComplete = 0;
  let recordsLookedUp = 0;
  let recordsEnriched = 0;
  let fallbackCount = 0;
  let noUsableMatch = 0;
  let errorCount = 0;
  let fieldsProposed = 0;

  for (
    let index = 0;
    index < records.length;
    index += 1
  ) {
    const record = records[index];

    console.log(
      `\n[${index + 1}/${records.length}] ${
        record.term
      }`
    );

    const missing =
      getMissingFields(record);

    if (missing.length === 0) {
      console.log(
        "  ✓ Already complete"
      );

      alreadyComplete += 1;

      continue;
    }

    recordsLookedUp += 1;

    try {
      const result =
        await enrichRecord(record);

      const changeCount =
        Object.keys(
          result.changes
        ).length;

      if (changeCount > 0) {
        recordsEnriched += 1;
        fieldsProposed +=
          changeCount;
      } else {
        noUsableMatch += 1;
      }

      if (result.fallbackUsed) {
        fallbackCount += 1;
      }

      if (result.errors.length > 0) {
        errorCount +=
          result.errors.length;
      }

      /*
       * --------------------------------------------------------
       * WRITE MODE
       * --------------------------------------------------------
       *
       * Only update Notion after the preview-style enrichment
       * has been completed and buildChanges() has verified that
       * every proposed field was originally empty.
       */
      if (!PREVIEW_MODE) {
        const notionChanges =
          buildChanges(
            record,
            result.changes
          );

        const notionChangeCount =
          Object.keys(
            notionChanges
          ).length;

        if (notionChangeCount > 0) {
          await updateNotionPage(
            record.id,
            notionChanges
          );

          console.log(
            `  ✓ Updated Notion (${notionChangeCount} fields)`
          );
        } else {
          console.log(
            "  No Notion changes required."
          );
        }
      }
    } catch (error) {
      errorCount += 1;

      console.log(
        `  ✗ Error: ${error.message}`
      );
    }

    /*
     * Avoid hammering the external APIs.
     */
    await sleep(
      REQUEST_DELAY
    );
  }

  /*
   * ----------------------------------------------------------
   * Summary
   * ----------------------------------------------------------
   */
  console.log();
  console.log(
    "========================================"
  );
  console.log(
    "ENRICHMENT COMPLETE"
  );
  console.log(
    "========================================"
  );

  console.log(
    `Mode:               ${
      PREVIEW_MODE
        ? "Preview"
        : "Write"
    }`
  );

  console.log(
    `Records found:      ${records.length}`
  );

  console.log(
    `Already complete:   ${alreadyComplete}`
  );

  console.log(
    `Records looked up:  ${recordsLookedUp}`
  );

  console.log(
    `Records enriched:   ${recordsEnriched}`
  );

  console.log(
    `Fallback used:      ${fallbackCount}`
  );

  console.log(
    `No usable match:    ${noUsableMatch}`
  );

  console.log(
    `Errors:             ${errorCount}`
  );

  console.log(
    `Fields proposed:    ${fieldsProposed}`
  );

  if (PREVIEW_MODE) {
    console.log();
    console.log(
      "Preview mode did not modify Notion."
    );

    console.log(
      "Review the proposed changes above."
    );

    console.log(
      "If they look correct, run:"
    );

    console.log();
    console.log(
      "  node _scripts/enrich-vocabulary.mjs"
    );
  } else {
    console.log();
    console.log(
      "Notion enrichment is complete."
    );

    console.log(
      "Next step:"
    );

    console.log(
      "  node _scripts/export-vocabulary.mjs"
    );
  }
}

/* ============================================================
 * START
 * ============================================================
 */

main().catch((error) => {
  console.error();
  console.error(
    "========================================"
  );
  console.error(
    "ENRICHMENT FAILED"
  );
  console.error(
    "========================================"
  );

  console.error(
    error.message
  );

  process.exit(1);
});
