import "dotenv/config";
import fs from "node:fs";

/*
 * Zodi Bell — Vocabulary Enrichment
 *
 * This script enriches vocabulary records stored in Notion.
 *
 * MODES
 * -----
 *
 * Preview:
 *   node _scripts/enrich-vocabulary.mjs --preview
 *
 * Write:
 *   node _scripts/enrich-vocabulary.mjs
 *
 * Preview mode is completely read-only.
 *
 * Write mode updates ONLY fields that are currently empty in Notion.
 *
 * The following fields are NEVER changed by this script:
 *   - Term
 *   - Source Preference
 *   - Tags
 *
 * The following fields may be filled when empty:
 *   - Short Definition
 *   - Part of Speech
 *   - Etymology
 *   - Source
 *   - URL
 *
 * SOURCE PREFERENCE
 * -----------------
 *
 * Source Preference = "dictionary"
 *   1. FreeDictionaryAPI.com
 *   2. Wikipedia
 *   3. Wiktionary (for missing etymology)
 *
 * Source Preference = "wikipedia"
 *   1. Wikipedia
 *   2. FreeDictionaryAPI.com
 *   3. Wiktionary (for missing etymology)
 *
 * IMPORTANT
 * ---------
 *
 * Notion remains the source of truth.
 *
 * This script does NOT export YAML.
 * Use export-vocabulary.mjs after enrichment to update:
 *
 *   _data/vocabulary_normalized.yml
 *
 * ENVIRONMENT VARIABLES
 * ---------------------
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
 * If NOTION_VERSION is not provided, the script uses:
 *
 *   2026-03-11
 *
 * API SOURCES
 * -----------
 *
 * FreeDictionaryAPI:
 *   https://freedictionaryapi.com/
 *
 * Wikipedia:
 *   https://en.wikipedia.org/api/rest_v1/
 *
 * Wiktionary:
 *   https://en.wiktionary.org/w/api.php
 *
 * Wiktionary is used specifically to retrieve etymology because
 * FreeDictionaryAPI does not provide etymology in the response data
 * used by this script.
 */

// ============================================================
// Configuration
// ============================================================

const PREVIEW_MODE = process.argv.includes("--preview");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;

const NOTION_VERSION =
  process.env.NOTION_VERSION || "2026-03-11";

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

/*
 * Keep requests reasonably gentle on external APIs.
 *
 * Wiktionary and Wikipedia are Wikimedia services, so we use a
 * slightly longer delay between requests than we might for a
 * local API.
 */
const REQUEST_DELAY = 500;

// ============================================================
// Expected Notion schema
// ============================================================

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

// ============================================================
// Utility helpers
// ============================================================

function isEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    value === ""
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTerm(term) {
  return String(term || "")
    .trim()
    .toLowerCase();
}

function formatSourceName(source) {
  if (source === "dictionary") {
    return "FreeDictionaryAPI.com";
  }

  if (source === "wikipedia") {
    return "Wikipedia.org";
  }

  if (source === "wiktionary") {
    return "Wiktionary.org";
  }

  return source;
}

/*
 * Recursively search an API response for one of several possible
 * property names.
 *
 * This makes the dictionary parser more tolerant of changes in
 * the API's nested response structure.
 */
function findFirstValue(value, propertyNames) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findFirstValue(
        item,
        propertyNames
      );

      if (!isEmpty(result)) {
        return result;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  for (const propertyName of propertyNames) {
    if (
      Object.prototype.hasOwnProperty.call(
        value,
        propertyName
      )
    ) {
      const candidate = value[propertyName];

      if (
        typeof candidate === "string" &&
        candidate.trim()
      ) {
        return candidate.trim();
      }
    }
  }

  for (const child of Object.values(value)) {
    const result = findFirstValue(
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
 * Convert a Notion rich_text property into plain text.
 */
function getRichTextValue(property) {
  if (
    !property ||
    property.type !== "rich_text" ||
    !Array.isArray(property.rich_text)
  ) {
    return "";
  }

  return property.rich_text
    .map((item) => item.plain_text || "")
    .join("")
    .trim();
}

/*
 * Convert a Notion title property into plain text.
 */
function getTitleValue(property) {
  if (
    !property ||
    property.type !== "title" ||
    !Array.isArray(property.title)
  ) {
    return "";
  }

  return property.title
    .map((item) => item.plain_text || "")
    .join("")
    .trim();
}

/*
 * Convert a Notion select property into its selected name.
 */
function getSelectValue(property) {
  if (
    !property ||
    property.type !== "select" ||
    !property.select
  ) {
    return "";
  }

  return property.select.name || "";
}

/*
 * Convert a Notion URL property into its URL.
 */
function getUrlValue(property) {
  if (
    !property ||
    property.type !== "url"
  ) {
    return "";
  }

  return property.url || "";
}

/*
 * Convert a Notion multi-select property into an array of
 * names.
 */
function getMultiSelectValues(property) {
  if (
    !property ||
    property.type !== "multi_select" ||
    !Array.isArray(property.multi_select)
  ) {
    return [];
  }

  return property.multi_select
    .map((item) => item.name)
    .filter(Boolean);
}

// ============================================================
// HTTP helper
// ============================================================

async function fetchJson(
  url,
  options = {},
  label = "API request"
) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `${label} failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

// ============================================================
// FreeDictionaryAPI
// ============================================================

/*
 * FreeDictionaryAPI is used for dictionary-style information:
 *
 *   - definition
 *   - part of speech
 *   - URL, when available
 *
 * It is NOT relied upon for etymology.
 */
async function lookupDictionary(term) {
  const url =
    `${FREE_DICTIONARY_URL}/` +
    encodeURIComponent(term);

  const data = await fetchJson(
    url,
    {},
    `FreeDictionaryAPI lookup for "${term}"`
  );

  const definition =
    extractDictionaryDefinition(data);

  const partOfSpeech =
    extractDictionaryPartOfSpeech(data);

  const sourceUrl =
    extractDictionaryUrl(data);

  return {
    source: "dictionary",
    sourceName: "FreeDictionaryAPI.com",
    definition,
    partOfSpeech,
    etymology: null,
    url: sourceUrl,
  };
}

function extractDictionaryDefinition(data) {
  return findFirstValue(
    data,
    [
      "definition",
      "gloss",
    ]
  );
}

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

function extractDictionaryUrl(data) {
  return findFirstValue(
    data,
    [
      "url",
      "sourceUrl",
      "source_url",
    ]
  );
}

// ============================================================
// Wikipedia
// ============================================================

/*
 * Wikipedia is used for:
 *
 *   - short definition / summary
 *   - source
 *   - URL
 *
 * Wikipedia is not relied upon for etymology.
 */
async function lookupWikipedia(term) {
  const url =
    `${WIKIPEDIA_URL}/` +
    encodeURIComponent(term);

  try {
    const data = await fetchJson(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
        },
      },
      `Wikipedia lookup for "${term}"`
    );

    if (
      !data ||
      !data.extract ||
      !data.content_urls ||
      !data.content_urls.desktop
    ) {
      return null;
    }

    return {
      source: "wikipedia",
      sourceName: "Wikipedia.org",
      definition:
        String(data.extract).trim() || null,
      partOfSpeech: null,
      etymology: null,
      url:
        data.content_urls.desktop.page ||
        null,
    };
  } catch (error) {
    /*
     * A missing Wikipedia page is normal for many vocabulary
     * words, so treat a 404/not-found style response as a
     * normal "no match" rather than a script error.
     */
    if (
      String(error.message).includes("HTTP 404")
    ) {
      return null;
    }

    throw error;
  }
}

// ============================================================
// Wiktionary
// ============================================================

/*
 * Wiktionary is used specifically for etymology.
 *
 * Wiktionary pages contain human-readable wiki markup rather
 * than a simple structured etymology field. We therefore use
 * the MediaWiki API to retrieve the raw page content and
 * extract the English-language Etymology section.
 *
 * This function deliberately does NOT attempt to replace the
 * dictionary or Wikipedia lookups for definitions.
 */
async function lookupWiktionary(term) {
  const pageTitle = term.trim();

  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    rvlimit: "1",
    titles: pageTitle,
    format: "json",
    formatversion: "2",
  });

  const url =
    `${WIKTIONARY_API_URL}?${params.toString()}`;

  let data;

  try {
    data = await fetchJson(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
        },
      },
      `Wiktionary lookup for "${term}"`
    );
  } catch (error) {
    if (
      String(error.message).includes("HTTP 404")
    ) {
      return null;
    }

    throw error;
  }

  const page =
    data?.query?.pages?.[0];

  if (!page || page.missing) {
    return null;
  }

  const wikitext =
    page.revisions?.[0]?.slots?.main?.content;

  if (
    typeof wikitext !== "string" ||
    !wikitext.trim()
  ) {
    return null;
  }

  const etymology =
    extractEnglishEtymology(wikitext);

  if (!etymology) {
    return {
      source: "wiktionary",
      sourceName: "Wiktionary.org",
      definition: null,
      partOfSpeech: null,
      etymology: null,
      url: buildWiktionaryUrl(term),
    };
  }

  return {
    source: "wiktionary",
    sourceName: "Wiktionary.org",
    definition: null,
    partOfSpeech: null,
    etymology,
    url: buildWiktionaryUrl(term),
  };
}

/*
 * Extract the English-language Etymology section.
 *
 * A typical Wiktionary entry looks approximately like:
 *
 *   ==English==
 *
 *   ===Etymology===
 *   ...
 *
 *   ===Pronunciation===
 *   ...
 *
 * We only want the text between the Etymology heading and
 * the next heading at the same level.
 *
 * The parser is intentionally conservative. If the page has
 * an unusual structure, it returns null rather than putting
 * unrelated content into Notion.
 */
function extractEnglishEtymology(wikitext) {
  const englishSectionMatch =
    wikitext.match(
      /^==\s*English\s*==([\s\S]*?)(?=^==[^=].*?==\s*$|\s*$)/im
    );

  const englishSection =
    englishSectionMatch
      ? englishSectionMatch[1]
      : wikitext;

  const etymologyMatch =
    englishSection.match(
      /^===\s*Etymology(?:\s*\d+)?\s*===([\s\S]*?)(?=^===.*?===\s*$|^==.*?==\s*$|\s*$)/im
    );

  if (!etymologyMatch) {
    return null;
  }

  const cleaned =
    cleanWiktionaryText(
      etymologyMatch[1]
    );

  return cleaned || null;
}

/*
 * Turn common Wiktionary markup into readable plain text.
 *
 * This is intentionally conservative. We don't need to fully
 * implement a Wiktionary parser; we only need a clean enough
 * etymology for the Notion rich_text field.
 */
function cleanWiktionaryText(text) {
  let value = String(text || "");

  // Remove comments.
  value = value.replace(
    /<!--[\s\S]*?-->/g,
    ""
  );

  // Remove templates such as {{...}}.
  value = removeBalancedTemplates(value);

  // Convert wiki links:
  // [[word]]       -> word
  // [[word|label]] -> label
  value = value.replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
    "$2"
  );

  value = value.replace(
    /\[\[([^\]]+)\]\]/g,
    "$1"
  );

  // Convert external links:
  // [https://example.com label] -> label
  value = value.replace(
    /\[(https?:\/\/\S+)\s+([^\]]+)\]/g,
    "$2"
  );

  // Remove bare external links.
  value = value.replace(
    /\[(https?:\/\/[^\s\]]+)\]/g,
    ""
  );

  // Remove simple HTML tags.
  value = value.replace(
    /<\/?[^>]+>/g,
    ""
  );

  // Remove emphasis markup.
  value = value.replace(
    /'{2,5}/g,
    ""
  );

  // Remove list markers.
  value = value.replace(
    /^\s*[*#:;]+\s*/gm,
    ""
  );

  // Normalize whitespace.
  value = value.replace(
    /\r/g,
    ""
  );

  value = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return value
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Remove balanced {{...}} template markup.
 *
 * Wiktionary templates can be nested, so a simple regex is not
 * sufficient. This small parser removes balanced double-curly
 * template blocks.
 */
function removeBalancedTemplates(text) {
  let result = "";
  let depth = 0;

  for (let i = 0; i < text.length; i += 1) {
    const current =
      text[i];

    const next =
      text[i + 1];

    if (
      current === "{" &&
      next === "{"
    ) {
      depth += 1;
      i += 1;
      continue;
    }

    if (
      current === "}" &&
      next === "}" &&
      depth > 0
    ) {
      depth -= 1;
      i += 1;
      continue;
    }

    if (depth === 0) {
      result += current;
    }
  }

  return result;
}

function buildWiktionaryUrl(term) {
  return (
    `${WIKTIONARY_PAGE_URL}/` +
    encodeURIComponent(term.trim().replace(/ /g, "_"))
  );
}

// ============================================================
// Notion helpers
// ============================================================

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

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    const message =
      data?.message ||
      `${response.status} ${response.statusText}`;

    throw new Error(
      `Notion API error: ${message}`
    );
  }

  return data;
}

async function getDataSource() {
  return notionRequest(
    `/v1/data_sources/${DATA_SOURCE_ID}`
  );
}

async function queryDataSource() {
  const records = [];
  let startCursor = undefined;

  do {
    const body = {
      page_size: 100,
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }

    const response =
      await notionRequest(
        `/v1/data_sources/${DATA_SOURCE_ID}/query`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

    records.push(
      ...(response.results || [])
    );

    startCursor =
      response.has_more
        ? response.next_cursor
        : null;
  } while (startCursor);

  return records;
}

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

// ============================================================
// Notion schema validation
// ============================================================

function validateNotionSchema(
  dataSource
) {
  const properties =
    dataSource.properties || {};

  let valid = true;

  for (const [
    propertyName,
    expectedType,
  ] of Object.entries(EXPECTED_SCHEMA)) {
    const actual =
      properties[propertyName];

    if (!actual) {
      console.log(
        `  ✗ Missing property: ${propertyName}`
      );

      valid = false;
      continue;
    }

    if (actual.type !== expectedType) {
      console.log(
        `  ✗ ${propertyName}: expected ${expectedType}, found ${actual.type}`
      );

      valid = false;
      continue;
    }

    console.log(
      `  ✓ ${propertyName} (${expectedType})`
    );
  }

  if (!valid) {
    throw new Error(
      "Notion schema validation failed."
    );
  }

  console.log(
    "Schema validation passed."
  );
}

// ============================================================
// Convert Notion page to vocabulary record
// ============================================================

function notionPageToRecord(page) {
  const properties =
    page.properties || {};

  return {
    id: page.id,

    term:
      getTitleValue(
        properties.Term
      ),

    source_preference:
      getSelectValue(
        properties["Source Preference"]
      ),

    short_definition:
      getRichTextValue(
        properties["Short Definition"]
      ),

    part_of_speech:
      getSelectValue(
        properties["Part of Speech"]
      ),

    etymology:
      getRichTextValue(
        properties.Etymology
      ),

    source:
      getSelectValue(
        properties.Source
      ),

    url:
      getUrlValue(
        properties.URL
      ),

    tags:
      getMultiSelectValues(
        properties.Tags
      ),
  };
}

// ============================================================
// Enrichment
// ============================================================

/*
 * Determine which fields are currently missing.
 */
function getMissingFields(record) {
  const missing = [];

  if (isEmpty(record.short_definition)) {
    missing.push("short_definition");
  }

  if (isEmpty(record.part_of_speech)) {
    missing.push("part_of_speech");
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
 * Add values from a source only to fields that are still
 * missing.
 *
 * Existing Notion values always win.
 */
function applySourceResult(
  result,
  enriched
) {
  if (!result) {
    return;
  }

  if (
    isEmpty(enriched.short_definition) &&
    !isEmpty(result.definition)
  ) {
    enriched.short_definition =
      result.definition;
  }

  if (
    isEmpty(enriched.part_of_speech) &&
    !isEmpty(result.partOfSpeech)
  ) {
    enriched.part_of_speech =
      result.partOfSpeech;
  }

  if (
    isEmpty(enriched.etymology) &&
    !isEmpty(result.etymology)
  ) {
    enriched.etymology =
      result.etymology;
  }

  if (
    isEmpty(enriched.source) &&
    !isEmpty(result.sourceName)
  ) {
    enriched.source =
      result.sourceName;
  }

  if (
    isEmpty(enriched.url) &&
    !isEmpty(result.url)
  ) {
    enriched.url =
      result.url;
  }
}

/*
 * Determine whether a source actually provided something useful.
 */
function sourceProvidedUsefulData(
  result,
  before
) {
  if (!result) {
    return false;
  }

  return (
    (
      isEmpty(before.short_definition) &&
      !isEmpty(result.definition)
    ) ||
    (
      isEmpty(before.part_of_speech) &&
      !isEmpty(result.partOfSpeech)
    ) ||
    (
      isEmpty(before.etymology) &&
      !isEmpty(result.etymology)
    ) ||
    (
      isEmpty(before.source) &&
      !isEmpty(result.sourceName)
    ) ||
    (
      isEmpty(before.url) &&
      !isEmpty(result.url)
    )
  );
}

/*
 * Enrich one vocabulary record.
 */
async function enrichRecord(record) {
  const missingBefore =
    getMissingFields(record);

  const enriched = {
    ...record,
  };

  const sourcesUsed = [];
  const fallbackUsed = [];

  const preferredSource =
    normalizeTerm(
      record.source_preference
    ) === "wikipedia"
      ? "wikipedia"
      : "dictionary";

  const sourceOrder =
    preferredSource === "wikipedia"
      ? ["wikipedia", "dictionary"]
      : ["dictionary", "wikipedia"];

  let preferredSourceSucceeded = false;

  // ----------------------------------------------------------
  // First pass: preferred source
  // ----------------------------------------------------------

  for (const source of sourceOrder) {
    /*
     * Once the preferred source has supplied everything that
     * it can reasonably supply, we don't need to call it again.
     *
     * We still allow the second source to fill fields that
     * remain empty.
     */
    if (
      source === "dictionary"
    ) {
      /*
       * FreeDictionaryAPI does not provide etymology, so it is
       * still useful even when etymology is the only missing
       * field. It may provide another missing field.
       */
      if (
        isEmpty(enriched.short_definition) ||
        isEmpty(enriched.part_of_speech) ||
        isEmpty(enriched.source) ||
        isEmpty(enriched.url)
      ) {
        try {
          const before = {
            ...enriched,
          };

          const result =
            await lookupDictionary(
              record.term
            );

          if (result) {
            sourcesUsed.push(
              formatSourceName(source)
            );

            if (
              source === preferredSource
            ) {
              preferredSourceSucceeded =
                sourceProvidedUsefulData(
                  result,
                  before
                );
            } else if (
              sourceProvidedUsefulData(
                result,
                before
              )
            ) {
              fallbackUsed.push(
                formatSourceName(source)
              );
            }

            applySourceResult(
              result,
              enriched
            );
          }
        } catch (error) {
          console.log(
            `    ⚠ ${formatSourceName(source)} error: ${error.message}`
          );
        }

        await sleep(REQUEST_DELAY);
      }
    }

    if (
      source === "wikipedia"
    ) {
      if (
        isEmpty(enriched.short_definition) ||
        isEmpty(enriched.source) ||
        isEmpty(enriched.url)
      ) {
        try {
          const before = {
            ...enriched,
          };

          const result =
            await lookupWikipedia(
              record.term
            );

          if (result) {
            sourcesUsed.push(
              formatSourceName(source)
            );

            if (
              source === preferredSource
            ) {
              preferredSourceSucceeded =
                sourceProvidedUsefulData(
                  result,
                  before
                );
            } else if (
              sourceProvidedUsefulData(
                result,
                before
              )
            ) {
              fallbackUsed.push(
                formatSourceName(source)
              );
            }

            applySourceResult(
              result,
              enriched
            );
          } else {
            console.log(
              "    wikipedia: no usable entry"
            );
          }
        } catch (error) {
          console.log(
            `    ⚠ ${formatSourceName(source)} error: ${error.message}`
          );
        }

        await sleep(REQUEST_DELAY);
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * Wiktionary pass
   * ----------------------------------------------------------
   *
   * Wiktionary is specifically responsible for filling a
   * missing etymology.
   *
   * It is also allowed to fill URL if URL is empty, because
   * the Wiktionary URL gives us a useful, word-specific source
   * page.
   *
   * Existing Source values are NEVER overwritten.
   */
  if (
    isEmpty(enriched.etymology) ||
    isEmpty(enriched.url)
  ) {
    try {
      const before = {
        ...enriched,
      };

      const result =
        await lookupWiktionary(
          record.term
        );

      if (result) {
        const providedUsefulData =
          sourceProvidedUsefulData(
            result,
            before
          );

        if (providedUsefulData) {
          sourcesUsed.push(
            "Wiktionary.org"
          );

          /*
           * Wiktionary is always a fallback/additional source
           * in this workflow because Source Preference controls
           * the primary definition source.
           */
          fallbackUsed.push(
            "Wiktionary.org"
          );
        }

        applySourceResult(
          result,
          enriched
        );
      } else {
        console.log(
          "    wiktionary: no usable entry"
        );
      }
    } catch (error) {
      console.log(
        `    ⚠ Wiktionary.org error: ${error.message}`
      );
    }

    await sleep(REQUEST_DELAY);
  }

  /*
   * Remove duplicate source names while preserving order.
   */
  const uniqueSourcesUsed = [
    ...new Set(sourcesUsed),
  ];

  const uniqueFallbacks = [
    ...new Set(fallbackUsed),
  ];

  return {
    record,
    enriched,
    missingBefore,
    sourcesUsed: uniqueSourcesUsed,
    fallbackUsed: uniqueFallbacks,
    preferredSourceSucceeded,
  };
}

// ============================================================
// Build Notion changes
// ============================================================

/*
 * Build a Notion properties object containing ONLY fields that
 * were originally empty.
 *
 * This is an important safety check.
 *
 * Even if enrichment somehow produces a different value for a
 * field that already contained data, that field will not be
 * included in the PATCH request.
 */
function buildChanges(
  original,
  enriched
) {
  const properties = {};
  const changes = [];

  if (
    isEmpty(original.short_definition) &&
    !isEmpty(enriched.short_definition)
  ) {
    properties["Short Definition"] = {
      rich_text: [
        {
          type: "text",
          text: {
            content:
              enriched.short_definition,
          },
        },
      ],
    };

    changes.push({
      field: "Short Definition",
      value:
        enriched.short_definition,
    });
  }

  if (
    isEmpty(original.part_of_speech) &&
    !isEmpty(enriched.part_of_speech)
  ) {
    properties["Part of Speech"] = {
      select: {
        name:
          enriched.part_of_speech,
      },
    };

    changes.push({
      field: "Part of Speech",
      value:
        enriched.part_of_speech,
    });
  }

  if (
    isEmpty(original.etymology) &&
    !isEmpty(enriched.etymology)
  ) {
    properties.Etymology = {
      rich_text: [
        {
          type: "text",
          text: {
            content:
              enriched.etymology,
          },
        },
      ],
    };

    changes.push({
      field: "Etymology",
      value:
        enriched.etymology,
    });
  }

  if (
    isEmpty(original.source) &&
    !isEmpty(enriched.source)
  ) {
    properties.Source = {
      select: {
        name:
          enriched.source,
      },
    };

    changes.push({
      field: "Source",
      value:
        enriched.source,
    });
  }

  if (
    isEmpty(original.url) &&
    !isEmpty(enriched.url)
  ) {
    properties.URL = {
      url:
        enriched.url,
    };

    changes.push({
      field: "URL",
      value:
        enriched.url,
    });
  }

  return {
    properties,
    changes,
  };
}

// ============================================================
// Display helpers
// ============================================================

function displayChange(change) {
  console.log(
    `    ${change.field}: ${change.value}`
  );
}

function displayMissingFields(
  missing
) {
  return missing
    .map((field) =>
      field.replaceAll("_", " ")
    )
    .join(", ");
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("");
  console.log("========================================");
  console.log("Vocabulary Enrichment");
  console.log("========================================");
  console.log("");

  console.log(
    PREVIEW_MODE
      ? "MODE: Preview (Notion will NOT be changed)"
      : "MODE: Write (Notion WILL be updated)"
  );

  console.log("");

  // ----------------------------------------------------------
  // Validate environment
  // ----------------------------------------------------------

  if (!NOTION_TOKEN) {
    throw new Error(
      "Missing NOTION_TOKEN environment variable."
    );
  }

  if (!DATA_SOURCE_ID) {
    throw new Error(
      "Missing NOTION_VOCABULARY_DATA_SOURCE_ID environment variable."
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

  console.log("");

  // ----------------------------------------------------------
  // Step 1: Check Notion data source
  // ----------------------------------------------------------

  console.log(
    "Step 1: Checking Notion data source..."
  );

  const dataSource =
    await getDataSource();

  console.log(
    `Connected to: ${
      dataSource.title?.[0]?.plain_text ||
      "Vocabulary"
    }`
  );

  console.log("");

  // ----------------------------------------------------------
  // Step 2: Validate schema
  // ----------------------------------------------------------

  console.log(
    "Step 2: Validating Notion schema..."
  );

  validateNotionSchema(
    dataSource
  );

  console.log("");

  // ----------------------------------------------------------
  // Step 3: Fetch records
  // ----------------------------------------------------------

  console.log(
    "Step 3: Fetching vocabulary records..."
  );

  const pages =
    await queryDataSource();

  console.log(
    `Found ${pages.length} records.`
  );

  console.log("");

  // ----------------------------------------------------------
  // Step 4: Prepare records
  // ----------------------------------------------------------

  console.log(
    "Step 4: Preparing vocabulary records..."
  );

  const records =
    pages
      .map(notionPageToRecord)
      .filter((record) => {
        if (!record.term) {
          console.log(
            `  ⚠ Skipping record ${record.id}: missing Term`
          );

          return false;
        }

        return true;
      });

  console.log(
    `Prepared ${records.length} records.`
  );

  console.log("");

  // ----------------------------------------------------------
  // Step 5: Enrich
  // ----------------------------------------------------------

  console.log(
    "Step 5: Enriching vocabulary..."
  );

  console.log("");

  let alreadyComplete = 0;
  let recordsLookedUp = 0;
  let recordsEnriched = 0;
  let fallbackUsedCount = 0;
  let noUsableMatch = 0;
  let errors = 0;
  let fieldsProposed = 0;
  let recordsWritten = 0;

  for (
    let index = 0;
    index < records.length;
    index += 1
  ) {
    const record =
      records[index];

    const missingBefore =
      getMissingFields(record);

    console.log(
      `[${index + 1}/${records.length}] ${record.term}`
    );

    if (
      missingBefore.length === 0
    ) {
      console.log(
        "  ✓ Complete — nothing to enrich."
      );

      console.log("");

      alreadyComplete += 1;

      continue;
    }

    console.log(
      `  Missing: ${displayMissingFields(
        missingBefore
      )}`
    );

    console.log(
      `  Source preference: ${
        record.source_preference || "dictionary"
      }`
    );

    recordsLookedUp += 1;

    let result;

    try {
      result =
        await enrichRecord(
          record
        );
    } catch (error) {
      errors += 1;

      console.log(
        `  ✗ Error: ${error.message}`
      );

      console.log("");

      continue;
    }

    if (
      result.sourcesUsed.length > 0
    ) {
      console.log(
        `  Sources used: ${
          result.sourcesUsed.join(", ")
        }`
      );
    } else {
      console.log(
        "  Sources used: none"
      );
    }

    if (
      result.fallbackUsed.length > 0
    ) {
      console.log(
        `  Fallback/additional sources: ${
          result.fallbackUsed.join(", ")
        }`
      );

      fallbackUsedCount += 1;
    }

    const {
      properties,
      changes,
    } =
      buildChanges(
        record,
        result.enriched
      );

    if (
      changes.length > 0
    ) {
      console.log(
        "  Proposed changes:"
      );

      for (
        const change of changes
      ) {
        displayChange(change);
      }

      fieldsProposed +=
        changes.length;

      recordsEnriched += 1;

      if (!PREVIEW_MODE) {
        try {
          await updateNotionPage(
            record.id,
            properties
          );

          console.log(
            "  ✓ Notion updated."
          );

          recordsWritten += 1;
        } catch (error) {
          errors += 1;

          console.log(
            `  ✗ Notion update failed: ${error.message}`
          );
        }
      }
    }

    const missingAfter =
      getMissingFields(
        result.enriched
      );

    if (
      missingAfter.length > 0
    ) {
      console.log(
        `  ⚠ Still missing: ${
          displayMissingFields(
            missingAfter
          )
        }`
      );
    }

    if (
      changes.length === 0
    ) {
      noUsableMatch += 1;
    }

    console.log("");

    /*
     * A small pause between vocabulary records prevents the
     * script from making a large burst of external requests.
     */
    await sleep(
      REQUEST_DELAY
    );
  }

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------

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
    `Fallback used:      ${fallbackUsedCount}`
  );

  console.log(
    `No usable match:    ${noUsableMatch}`
  );

  console.log(
    `Errors:             ${errors}`
  );

  console.log(
    `Fields proposed:    ${fieldsProposed}`
  );

  if (!PREVIEW_MODE) {
    console.log(
      `Records written:    ${recordsWritten}`
    );
  }

  console.log("");

  if (PREVIEW_MODE) {
    console.log(
      "Preview mode did not modify Notion."
    );

    console.log(
      "Review the proposed changes above."
    );

    console.log(
      "If they look correct, run:"
    );

    console.log("");

    console.log(
      "  node _scripts/enrich-vocabulary.mjs"
    );
  } else {
    console.log(
      "Notion enrichment is complete."
    );

    console.log(
      "Next step:"
    );

    console.log("");

    console.log(
      "  node _scripts/export-vocabulary.mjs"
    );
  }

  console.log("");
}

// ============================================================
// Run
// ============================================================

main().catch((error) => {
  console.error("");
  console.error(
    "========================================"
  );
  console.error(
    "ENRICHMENT FAILED"
  );
  console.error(
    "========================================"
  );
  console.error("");
  console.error(
    error.message
  );
  console.error("");

  process.exit(1);
});
