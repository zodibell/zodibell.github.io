const fs = require("fs");
const yaml = require("js-yaml");

const original = yaml.load(
  fs.readFileSync("./vocabulary-original.yml", "utf8")
);

const exported = yaml.load(
  fs.readFileSync("_data/vocabulary.yml", "utf8")
);

const fields = [
  "source_preference",
  "short_definition",
  "part_of_speech",
  "etymology",
  "source",
  "url",
  "tags",
];

function normalize(value) {
  return value === "" ? null : value;
}

const originalByTerm = new Map(
  original.map((record) => [record.term.toLowerCase(), record])
);

const exportedByTerm = new Map(
  exported.map((record) => [record.term.toLowerCase(), record])
);

let differences = 0;

for (const [key, originalRecord] of originalByTerm) {
  const exportedRecord = exportedByTerm.get(key);

  if (!exportedRecord) {
    console.log(`MISSING FROM EXPORT: ${originalRecord.term}`);
    differences++;
    continue;
  }

  for (const field of fields) {
    const originalValue = normalize(
      JSON.stringify(originalRecord[field] ?? null)
    );

    const exportedValue = normalize(
      JSON.stringify(exportedRecord[field] ?? null)
    );

    if (originalValue !== exportedValue) {
      console.log(`DIFFERENCE: ${originalRecord.term} | ${field}`);
      console.log(
        `  original: ${JSON.stringify(originalRecord[field])}`
      );
      console.log(
        `  export:   ${JSON.stringify(exportedRecord[field])}`
      );
      differences++;
    }
  }
}

for (const [key, exportedRecord] of exportedByTerm) {
  if (!originalByTerm.has(key)) {
    console.log(`NEW IN EXPORT: ${exportedRecord.term}`);
    differences++;
  }
}

console.log("\n================================");
console.log(`Records in original: ${original.length}`);
console.log(`Records in export:   ${exported.length}`);
console.log(`Differences found:   ${differences}`);

if (differences === 0) {
  console.log("✓ All vocabulary data matches.");
}
