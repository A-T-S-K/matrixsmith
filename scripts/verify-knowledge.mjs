import { readFileSync } from "node:fs";
import validate from "../src/knowledge/generated/knowledge-validator.js";
import { validateKnowledgeReferences } from "../src/knowledge/validation.ts";
const text = readFileSync("public/knowledge-v1.json", "utf8");
if (Buffer.byteLength(text) > 256 * 1024)
  throw new Error("Knowledge byte limit exceeded.");
const corpus = JSON.parse(text);
if (!validate(corpus)) throw new Error(JSON.stringify(validate.errors));
validateKnowledgeReferences(corpus);
console.log(
  `Knowledge validated: ${corpus.records.length} records, ${corpus.sheets.length} sheets, ${corpus.assertions.length} assertions.`,
);
