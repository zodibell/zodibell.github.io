import "dotenv/config";

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
 * The following fields are NEVER changed:
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
 *   3. Wiktionary for missing etymology
 *
 * Source Preference = "wikipedia"
 *   1. Wikipedia
 *   2. FreeDictionaryAPI.com
 *   3. Wiktionary for missing etymology
 *
 * Wiktionary is used specifically to fill missing etymology.
 *
 * NOTION REMAINS THE SOURCE OF TRUTH.
 *
 * This script does NOT export YAML.
 *
 * After enrichment, run:
 *
 *   node _scripts/export-vocabulary.mjs
 *
 * to update:
 *
 *   _data/vocabulary_normalized.yml
 */

// ============================================================
// Configuration
// ============================================================

const PREVIEW_MODE = process.argv.includes("--preview");

const NOTION_TOKEN = process.env.NOTION_TOKEN;

const DATA_SOURCE_ID =
  process.env.NOTION_VOCABULARY_DATA_SOURCE_ID;

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
 * Recursively search an API response for one of several
 * possible property names.
 */
function findFirstValue(value, propertyNames) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (Array.isArray(value)) {
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

  if (typeof value !== "object") {
    return null;
  }

  for (
    const propertyName of propertyNames
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
    const child of Object.values(value)
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

// ============================================================
// HTTP helper
// ============================================================

async function fetchJson(
  url,
  options = {},
  label = "API request"
) {
  const response =
    await fetch(url, {
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
 * FreeDictionaryAPI is used for:
 *
 *   - Short Definition
 *   - Part of Speech
 *
 * We do not rely on it for etymology.
 */
async function lookupDictionary(term) {
  const url =
    `${FREE_DICTIONARY_URL}/` +
    encodeURIComponent(term);

  const data =
    await fetchJson(
      url,
      {},
      `FreeDictionaryAPI lookup for "${term}"`
    );

  return {
    source: "dictionary",
    sourceName: "FreeDictionaryAPI.com",

    definition:
      extractDictionaryDefinition(
        data
      ),

    partOfSpeech:
      extractDictionaryPartOfSpeech(
        data
      ),

    etymology: null,

    /*
     * Do not use a generic/base API URL as the vocabulary URL.
     */
    url: null,
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

// ============================================================
// Wikipedia
// ============================================================

/*
 * Wikipedia is used for:
 *
 *   - Short Definition
 *   - Source
 *   - URL
 *
 * It is not relied upon for etymology.
 */
async function lookupWikipedia(term) {
  const url =
    `${WIKIPEDIA_URL}/` +
    encodeURIComponent(term);

  try {
    const data =
      await fetchJson(
        url,
        {
          headers: {
            "User-Agent":
              USER_AGENT,
          },
        },
        `Wikipedia lookup for "${term}"`
      );

    if (
      !data ||
      !data.extract ||
      !data.content_urls?.desktop?.page
    ) {
      return null;
    }

    return {
      source: "wikipedia",
      sourceName: "Wikipedia.org",

      definition:
        String(
          data.extract
        ).trim() || null,

      partOfSpeech: null,
      etymology: null,

      url:
        data.content_urls
          .desktop
          .page,
    };
  } catch (error) {
    /*
     * Missing Wikipedia pages are normal for many vocabulary
     * words, so treat a 404 as a normal no-match.
     */
    if (
      String(
        error.message
      ).includes("HTTP 404")
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
 * Wiktionary is used specifically for Etymology.
 *
 * We use MediaWiki's Parse API rather than trying to interpret
 * Wiktionary's wikitext ourselves.
 *
 * The Parse API can return the rendered HTML of a page with:
 *
 *   action=parse
 *   prop=text
 *
 * This is important because Wiktionary etymologies contain
 * templates and links whose visible text is lost if we simply
 * strip the raw wikitext.
 *
 * MediaWiki documentation:
 *
 *   https://www.mediawiki.org/wiki/API:Parsing_wikitext
 */
async function lookupWiktionary(term) {
  const params =
    new URLSearchParams({
      action: "parse",

      page: term.trim(),

      prop: "text",

      format: "json",

      formatversion: "2",
    });

  const url =
    `${WIKTIONARY_API_URL}?${params.toString()}`;

  let data;

  try {
    data =
      await fetchJson(
        url,
        {
          headers: {
            "User-Agent":
              USER_AGENT,
          },
        },
        `Wiktionary lookup for "${term}"`
      );
  } catch (error) {
    if (
      String(
        error.message
      ).includes("HTTP 404")
    ) {
      return null;
    }

    throw error;
  }

  const html =
    data?.parse?.text;

  if (
    typeof html !== "string" ||
    !html.trim()
  ) {
    return null;
  }

  const etymology =
    extractEnglishEtymologyFromHtml(
      html
    );

  /*
   * A Wiktionary page existing is not enough.
   *
   * We only consider the result useful when we actually find
   * an English Etymology section containing readable text.
   */
  if (!etymology) {
    return null;
  }

  return {
    source: "wiktionary",
    sourceName: "Wiktionary.org",

    definition: null,
    partOfSpeech: null,

    etymology,

    url:
      buildWiktionaryUrl(term),
  };
}

/*
 * Extract the English Etymology section from Wiktionary's
 * rendered HTML.
 *
 * Wiktionary headings are rendered approximately like:
 *
 *   <h2 id="English">English</h2>
 *   ...
 *   <h3 id="Etymology">Etymology</h3>
 *   ...
 *
 * We locate:
 *
 *   English
 *     ↓
 *   Etymology
 *     ↓
 *   content until the next same-level subsection
 *
 * This avoids accidentally including sections such as:
 *
 *   Noun
 *   Verb
 *   Pronunciation
 *   Derived terms
 *   Translations
 */
function extractEnglishEtymologyFromHtml(
  html
) {
  /*
   * Match headings in the rendered HTML.
   *
   * The heading level tells us which section we are in.
   */
  const headingRegex =
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

  const headings = [];

  let match;

  while (
    (match =
      headingRegex.exec(html)) !== null
  ) {
    headings.push({
      level:
        Number(match[1]),

      title:
        htmlToPlainText(
          match[2]
        ),

      start:
        match.index,

      end:
        headingRegex.lastIndex,
    });
  }

  if (
    headings.length === 0
  ) {
    return null;
  }

  /*
   * Find the English heading.
   */
  const englishIndex =
    headings.findIndex(
      (heading) =>
        normalizeHeading(
          heading.title
        ) === "english"
    );

  if (
    englishIndex === -1
  ) {
    return null;
  }

  const englishHeading =
    headings[englishIndex];

  /*
   * Find Etymology beneath English.
   *
   * It must be a deeper heading than English.
   */
  let etymologyIndex = -1;

  for (
    let i = englishIndex + 1;
    i < headings.length;
    i += 1
  ) {
    const heading =
      headings[i];

    /*
     * We have left English.
     */
    if (
      heading.level <=
      englishHeading.level
    ) {
      break;
    }

    if (
      normalizeHeading(
        heading.title
      ).startsWith(
        "etymology"
      )
    ) {
      etymologyIndex = i;
      break;
    }
  }

  if (
    etymologyIndex === -1
  ) {
    return null;
  }

  const etymologyHeading =
    headings[etymologyIndex];

  /*
   * The etymology section ends at the next heading with the
   * same or higher level.
   */
  let end =
    html.length;

  for (
    let i =
      etymologyIndex + 1;
    i < headings.length;
    i += 1
  ) {
    const heading =
      headings[i];

    if (
      heading.level <=
      etymologyHeading.level
    ) {
      end =
        heading.start;

      break;
    }
  }

  /*
   * If the next heading belongs to a later language section,
   * the English section boundary also protects us.
   */
  for (
    let i =
      etymologyIndex + 1;
    i < headings.length;
    i += 1
  ) {
    const heading =
      headings[i];

    if (
      heading.level <=
      englishHeading.level
    ) {
      end =
        Math.min(
          end,
          heading.start
        );

      break;
    }
  }

  const sectionHtml =
    html.slice(
      etymologyHeading.end,
      end
    );

  return cleanEtymologyHtml(
    sectionHtml
  );
}

function normalizeHeading(value) {
  return String(
    value || ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toLowerCase();
}

/*
 * Convert the small HTML fragment returned for an Etymology
 * section into clean plain text.
 */
function cleanEtymologyHtml(
  html
) {
  let value =
    String(html || "");

  /*
   * Remove script/style/noscript blocks.
   */
  value =
    value.replace(
      /<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    );

  /*
   * Preserve paragraph/list boundaries as spaces.
   */
  value =
    value.replace(
      /<\/(p|li|dd|dt|div|blockquote|br)>/gi,
      " "
    );

  /*
   * Remove remaining HTML tags.
   */
  value =
    value.replace(
      /<[^>]+>/g,
      ""
    );

  /*
   * Decode the most common HTML entities.
   *
   * We do this ourselves so the script has no additional
   * dependency.
   */
  value =
    decodeHtmlEntities(
      value
    );

  /*
   * Normalize whitespace.
   */
  value =
    value.replace(
      /\s+/g,
      " "
    );

  /*
   * Remove leading/trailing whitespace.
   */
  value =
    value.trim();

  /*
   * Remove accidental punctuation left by empty elements.
   *
   * For example:
   *
   *   "From ."
   *
   * should not be treated as a useful etymology.
   */
  value =
    value.replace(
      /\s+([,.;:])/g,
      "$1"
    );

  return isUsableEtymology(
    value
  )
    ? value
    : null;
}

function htmlToPlainText(
  html
) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );
}

function decodeHtmlEntities(
  text
) {
  return String(
    text || ""
  )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCodePoint(
          Number(code)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) =>
        String.fromCodePoint(
          parseInt(
            code,
            16
          )
        )
    );
}

function isUsableEtymology(
  value
) {
  if (
    !value ||
    value.length < 3
  ) {
    return false;
  }

  /*
   * Reject obvious empty/template remnants.
   */
  if (
    /^(from|borrowed from|derived from|ultimately from)\s*[.,;:]*$/i.test(
      value
    )
  ) {
    return false;
  }

  /*
   * Reject values consisting almost entirely of punctuation.
   */
  const letters =
    value.match(
      /[A-Za-zÀ-ÖØ-öø-ÿ]/g
    );

  if (
    !letters ||
    letters.length < 3
  ) {
    return false;
  }

  return true;
}

function buildWiktionaryUrl(
  term
) {
  return (
    `${WIKTIONARY_PAGE_URL}/` +
    encodeURIComponent(
      term
        .trim()
        .replace(
          / /g,
          "_"
        )
    )
  );
}

// ============================================================
// Notion helpers
// ============================================================

function notionHeaders() {
  return {
    Authorization:
      `Bearer ${NOTION_TOKEN}`,

    "Notion-Version":
      NOTION_VERSION,

    "Content-Type":
      "application/json",
  };
}

async function notionRequest(
  path,
  options = {}
) {
  const response =
    await fetch(
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
      text
        ? JSON.parse(text)
        : {};
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

  let startCursor =
    undefined;

  do {
    const body = {
      page_size: 100,
    };

    if (startCursor) {
      body.start_cursor =
        startCursor;
    }

    const response =
      await notionRequest(
        `/v1/data_sources/${DATA_SOURCE_ID}/query`,
        {
          method: "POST",
          body: JSON.stringify(
            body
          ),
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
// Notion property helpers
// ============================================================

function getRichTextValue(
  property
) {
  if (
    !property ||
    property.type !== "rich_text" ||
    !Array.isArray(
      property.rich_text
    )
  ) {
    return "";
  }

  return property.rich_text
    .map(
      (item) =>
        item.plain_text || ""
    )
    .join("")
    .trim();
}

function getTitleValue(
  property
) {
  if (
    !property ||
    property.type !== "title" ||
    !Array.isArray(
      property.title
    )
  ) {
    return "";
  }

  return property.title
    .map(
      (item) =>
        item.plain_text || ""
    )
    .join("")
    .trim();
}

function getSelectValue(
  property
) {
  if (
    !property ||
    property.type !== "select" ||
    !property.select
  ) {
    return "";
  }

  return property.select.name || "";
}

function getUrlValue(
  property
) {
  if (
    !property ||
    property.type !== "url"
  ) {
    return "";
  }

  return property.url || "";
}

function getMultiSelectValues(
  property
) {
  if (
    !property ||
    property.type !== "multi_select" ||
    !Array.isArray(
      property.multi_select
    )
  ) {
    return [];
  }

  return property.multi_select
    .map(
      (item) =>
        item.name
    )
    .filter(Boolean);
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

  for (
    const [
      propertyName,
      expectedType,
    ] of Object.entries(
      EXPECTED_SCHEMA
    )
  ) {
    const actual =
      properties[propertyName];

    if (!actual) {
      console.log(
        `  ✗ Missing property: ${propertyName}`
      );

      valid = false;
      continue;
    }

    if (
      actual.type !== expectedType
    ) {
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
// Convert Notion page to record
// ============================================================

function notionPageToRecord(
  page
) {
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
        properties[
          "Source Preference"
        ]
      ),

    short_definition:
      getRichTextValue(
        properties[
          "Short Definition"
        ]
      ),

    part_of_speech:
      getSelectValue(
        properties[
          "Part of Speech"
        ]
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
// Enrichment helpers
// ============================================================

function getMissingFields(
  record
) {
  const missing = [];

  if (
    isEmpty(
      record.short_definition
    )
  ) {
    missing.push(
      "short_definition"
    );
  }

  if (
    isEmpty(
      record.part_of_speech
    )
  ) {
    missing.push(
      "part_of_speech"
    );
  }

  if (
    isEmpty(
      record.etymology
    )
  ) {
    missing.push(
      "etymology"
    );
  }

  if (
    isEmpty(record.source)
  ) {
    missing.push(
      "source"
    );
  }

  if (
    isEmpty(record.url)
  ) {
    missing.push(
      "url"
    );
  }

  return missing;
}

/*
 * Apply a source result only to fields that are currently empty.
 *
 * Existing Notion data always wins.
 */
function applySourceResult(
  result,
  enriched
) {
  if (!result) {
    return;
  }

  if (
    isEmpty(
      enriched.short_definition
    ) &&
    !isEmpty(result.definition)
  ) {
    enriched.short_definition =
      result.definition;
  }

  if (
    isEmpty(
      enriched.part_of_speech
    ) &&
    !isEmpty(
      result.partOfSpeech
    )
  ) {
    enriched.part_of_speech =
      result.partOfSpeech;
  }

  if (
    isEmpty(
      enriched.etymology
    ) &&
    !isEmpty(
      result.etymology
    )
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

function sourceProvidedUsefulData(
  result,
  before
) {
  if (!result) {
    return false;
  }

  return (
    (
      isEmpty(
        before.short_definition
      ) &&
      !isEmpty(
        result.definition
      )
    ) ||
    (
      isEmpty(
        before.part_of_speech
      ) &&
      !isEmpty(
        result.partOfSpeech
      )
    ) ||
    (
      isEmpty(
        before.etymology
      ) &&
      !isEmpty(
        result.etymology
      )
    ) ||
    (
      isEmpty(before.source) &&
      !isEmpty(
        result.sourceName
      )
    ) ||
    (
      isEmpty(before.url) &&
      !isEmpty(result.url)
    )
  );
}

// ============================================================
// Enrich one record
// ============================================================

async function enrichRecord(
  record
) {
  const missingBefore =
    getMissingFields(
      record
    );

  const enriched = {
    ...record,
  };

  const sourcesUsed = [];
  const fallbackUsed = [];

  const preferredSource =
    String(
      record.source_preference ||
        ""
    ).toLowerCase() ===
  "wikipedia"
    ? "wikipedia"
    : "dictionary";

  const sourceOrder =
    preferredSource ===
    "wikipedia"
      ? [
          "wikipedia",
          "dictionary",
        ]
      : [
          "dictionary",
          "wikipedia",
        ];

  /*
   * ----------------------------------------------------------
   * Primary definition sources
   * ----------------------------------------------------------
   */

  for (
    const source of sourceOrder
  ) {
    if (
      source === "dictionary"
    ) {
      /*
       * Only call the dictionary when it can still provide
       * something useful.
       *
       * It does not provide etymology.
       */
      if (
        isEmpty(
          enriched.short_definition
        ) ||
        isEmpty(
          enriched.part_of_speech
        )
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
            if (
              sourceProvidedUsefulData(
                result,
                before
              )
            ) {
              sourcesUsed.push(
                formatSourceName(
                  source
                )
              );
            }

            applySourceResult(
              result,
              enriched
            );
          }
        } catch (error) {
          console.log(
            `    ${formatSourceName(
              source
            )} error: ${
              error.message
            }`
          );
        }

        await sleep(
          REQUEST_DELAY
        );
      }
    }

    if (
      source === "wikipedia"
    ) {
      if (
        isEmpty(
          enriched.short_definition
        ) ||
        isEmpty(
          enriched.source
        ) ||
        isEmpty(
          enriched.url
        )
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
            if (
              sourceProvidedUsefulData(
                result,
                before
              )
            ) {
              sourcesUsed.push(
                formatSourceName(
                  source
                )
              );

              /*
               * If Wikipedia was not the preferred source,
               * record it as a fallback.
               */
              if (
                source !==
                preferredSource
              ) {
                fallbackUsed.push(
                  formatSourceName(
                    source
                  )
                );
              }
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
            `    ${formatSourceName(
              source
            )} error: ${
              error.message
            }`
          );
        }

        await sleep(
          REQUEST_DELAY
        );
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * Wiktionary — etymology
   * ----------------------------------------------------------
   *
   * Wiktionary is only queried when Etymology is missing.
   */
  if (
    isEmpty(
      enriched.etymology
    )
  ) {
    try {
      const result =
        await lookupWiktionary(
          record.term
        );

      if (result) {
        sourcesUsed.push(
          "Wiktionary.org"
        );

        fallbackUsed.push(
          "Wiktionary.org"
        );

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
        `    Wiktionary.org error: ${
          error.message
        }`
      );
    }

    await sleep(
      REQUEST_DELAY
    );
  }

  return {
    record,
    enriched,
    missingBefore,
    sourcesUsed: [
      ...new Set(
        sourcesUsed
      ),
    ],
    fallbackUsed: [
      ...new Set(
        fallbackUsed
      ),
    ],
  };
}

// ============================================================
// Build Notion changes
// ============================================================

/*
 * Build a PATCH containing ONLY fields that were originally
 * empty.
 *
 * This is the final safety barrier against overwriting
 * user-entered data.
 */
function buildChanges(
  original,
  enriched
) {
  const properties = {};
  const changes = [];

  if (
    isEmpty(
      original.short_definition
    ) &&
    !isEmpty(
      enriched.short_definition
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
              enriched.short_definition,
          },
        },
      ],
    };

    changes.push({
      field:
        "Short Definition",

      value:
        enriched.short_definition,
    });
  }

  if (
    isEmpty(
      original.part_of_speech
    ) &&
    !isEmpty(
      enriched.part_of_speech
    )
  ) {
    properties[
      "Part of Speech"
    ] = {
      select: {
        name:
          enriched.part_of_speech,
      },
    };

    changes.push({
      field:
        "Part of Speech",

      value:
        enriched.part_of_speech,
    });
  }

  if (
    isEmpty(
      original.etymology
    ) &&
    !isEmpty(
      enriched.etymology
    )
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
      field:
        "Etymology",

      value:
        enriched.etymology,
    });
  }

  if (
    isEmpty(
      original.source
    ) &&
    !isEmpty(
      enriched.source
    )
  ) {
    properties.Source = {
      select: {
        name:
          enriched.source,
      },
    };

    changes.push({
      field:
        "Source",

      value:
        enriched.source,
    });
  }

  if (
    isEmpty(
      original.url
    ) &&
    !isEmpty(
      enriched.url
    )
  ) {
    properties.URL = {
      url:
        enriched.url,
    };

    changes.push({
      field:
        "URL",

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
// Main
// ============================================================

async function main() {
  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "Vocabulary Enrichment"
  );
  console.log(
    "========================================"
  );
  console.log("");

  console.log(
    PREVIEW_MODE
      ? "MODE: Preview (Notion will NOT be changed)"
      : "MODE: Write (Notion WILL be updated)"
  );

  console.log("");

  // ----------------------------------------------------------
  // Environment
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
  // Step 1
  // ----------------------------------------------------------

  console.log(
    "Step 1: Checking Notion data source..."
  );

  const dataSource =
    await getDataSource();

  console.log(
    `Connected to: ${
      dataSource.title?.[0]
        ?.plain_text ||
      "Vocabulary"
    }`
  );

  console.log("");

  // ----------------------------------------------------------
  // Step 2
  // ----------------------------------------------------------

  console.log(
    "Step 2: Validating Notion schema..."
  );

  validateNotionSchema(
    dataSource
  );

  console.log("");

  // ----------------------------------------------------------
  // Step 3
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
  // Step 4
  // ----------------------------------------------------------

  console.log(
    "Step 4: Preparing vocabulary records..."
  );

  const records =
    pages
      .map(
        notionPageToRecord
      )
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
  // Step 5
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
      getMissingFields(
        record
      );

    console.log(
      `[${index + 1}/${records.length}] ${
        record.term
      }`
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
      `  Missing: ${
        missingBefore
          .map((field) =>
            field.replaceAll(
              "_",
              " "
            )
          )
          .join(", ")
      }`
    );

    console.log(
      `  Source preference: ${
        record.source_preference ||
        "dictionary"
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
        `  ✗ Error: ${
          error.message
        }`
      );

      console.log("");

      continue;
    }

    if (
      result.sourcesUsed
        .length > 0
    ) {
      console.log(
        `  Sources used: ${
          result.sourcesUsed.join(
            ", "
          )
        }`
      );
    } else {
      console.log(
        "  Sources used: none"
      );
    }

    if (
      result.fallbackUsed
        .length > 0
    ) {
      console.log(
        `  Fallback/additional sources: ${
          result.fallbackUsed.join(
            ", "
          )
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
        console.log(
          `    ${change.field}: ${change.value}`
        );
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
            `  ✗ Notion update failed: ${
              error.message
            }`
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
          missingAfter
            .map((field) =>
              field.replaceAll(
                "_",
                " "
              )
            )
            .join(", ")
        }`
      );
    }

    if (
      changes.length === 0
    ) {
      noUsableMatch += 1;
    }

    console.log("");

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

main().catch(
  (error) => {
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
  }
);
