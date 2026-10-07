import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import validateKnowledge from "../src/knowledge/generated/knowledge-validator.js";
import { validateKnowledgeReferences } from "../src/knowledge/validation.ts";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const root = resolve(process.argv[2] ?? "dist");
const required = [
  "index.html",
  "asset-manifest.json",
  "build-metadata.json",
  "manifest.webmanifest",
  "sw.js",
  "_headers",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "bundle-v3.schema.json",
  "profile-v1.schema.json",
  "profile-v2.schema.json",
  "knowledge-v1.schema.json",
  "knowledge-v1.json",
];
const failures = [];
const INITIAL_ROUTE_JS_GZIP_LIMIT = 90 * 1024;
// Provisional independent offline-family allowance; see docs/asset-budgets.md.
const TOTAL_JS_GZIP_LIMIT = 240 * 1024;
for (const file of required)
  if (!existsSync(join(root, file)))
    failures.push(`Missing required static file: ${file}`);
for (const forbidden of ["_worker.js", "functions"])
  if (existsSync(join(root, forbidden)))
    failures.push(`Backend artifact is forbidden: ${forbidden}`);

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

if (existsSync(root)) {
  const output = files(root);
  const textFiles = output.filter((file) =>
    /\.(?:html|js|css|json|webmanifest)$/.test(file),
  );
  const javascript = output.filter((file) => file.endsWith(".js"));
  const totalJsGzip = javascript.reduce(
    (total, file) => total + gzipSync(readFileSync(file)).byteLength,
    0,
  );
  if (totalJsGzip > TOTAL_JS_GZIP_LIMIT)
    failures.push(
      `Total JavaScript is ${totalJsGzip} bytes gzip; budget is ${TOTAL_JS_GZIP_LIMIT}.`,
    );
  else console.log(`Total JavaScript: ${totalJsGzip} bytes gzip.`);
  const html = readFileSync(join(root, "index.html"), "utf8");
  verifyRecoveryMap(html);
  const entryReference = html.match(
    /<script[^>]+src=["']([^"']+\.js)["']/,
  )?.[1];
  if (entryReference) {
    const entryPath = resolve(
      root,
      entryReference.replace(/^\.\//, "").replace(/^\//, ""),
    );
    if (existsSync(entryPath)) {
      const initialJavascript = collectInitialJavascript(html, entryPath);
      const initialGzip = [...initialJavascript].reduce(
        (total, file) => total + gzipSync(readFileSync(file)).byteLength,
        0,
      );
      if (initialGzip > INITIAL_ROUTE_JS_GZIP_LIMIT)
        failures.push(
          `Initial JavaScript is ${initialGzip} bytes gzip across ${initialJavascript.size} static dependencies; enforced budget is ${INITIAL_ROUTE_JS_GZIP_LIMIT}.`,
        );
      else
        console.log(
          `Initial JavaScript: ${initialGzip} bytes gzip across ${initialJavascript.size} static dependencies.`,
        );
    }
  }
  for (const file of textFiles) {
    const source = readFileSync(file, "utf8");
    if (
      /__coverage__|__MATRIXSMITH_BUILD_ID__|__MATRIXSMITH_ASSETS__/.test(
        source,
      )
    )
      failures.push(
        `Test instrumentation or unsubstituted build token in ${relative(root, file)}`,
      );
    if (/simulated-iledhat|matrixsmithTransport/.test(source))
      failures.push(
        `Development simulator leaked into ${relative(root, file)}`,
      );
    let checkedSource = source;
    if (relative(root, file) === "knowledge-v1.json") {
      try {
        if (Buffer.byteLength(source) > 256 * 1024)
          throw new Error("Knowledge data exceeds byte limit.");
        const corpus = JSON.parse(source);
        if (!validateKnowledge(corpus))
          throw new Error("Invalid knowledge schema.");
        validateKnowledgeReferences(corpus);
        // The sole data-citation exception. All other strings remain origin-scanned.
        for (const citation of corpus.sources) citation.url = null;
        checkedSource = JSON.stringify(corpus);
      } catch (error) {
        failures.push(`Invalid provenance data: ${String(error)}`);
      }
    }
    const withoutMarkupNamespaces = checkedSource
      .replaceAll(
        /https?:\/\/www\.w3\.org\/(?:1999\/xhtml|2000\/svg|1998\/Math\/MathML)/g,
        "",
      )
      .replaceAll("https://json-schema.org/draft/2020-12/schema", "");
    if (/https?:\/\//.test(withoutMarkupNamespaces))
      failures.push(
        `Unexpected external origin appears in ${relative(root, file)}`,
      );
    for (const match of source.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)) {
      const reference = match[1];
      if (!reference || /^(?:data:|https?:)/.test(reference)) continue;
      const target = resolve(
        root,
        reference.replace(/^\.\//, "").replace(/^\//, ""),
      );
      if (!existsSync(target))
        failures.push(
          `Missing reference ${reference} from ${relative(root, file)}`,
        );
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`Static output verified: ${root}`);

/** Dynamic import targets are intentionally excluded; modulepreloads and static imports are initial. */
function collectInitialJavascript(html, entryPath) {
  const pending = [entryPath];
  for (const match of html.matchAll(
    /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+\.js)["']/g,
  ))
    pending.push(
      resolve(root, match[1].replace(/^\.\//, "").replace(/^\//, "")),
    );
  const found = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || found.has(file) || !existsSync(file)) continue;
    found.add(file);
    const source = readFileSync(file, "utf8");
    if (
      /__coverage__|__MATRIXSMITH_BUILD_ID__|__MATRIXSMITH_ASSETS__/.test(
        source,
      )
    )
      failures.push(
        `Test instrumentation or unsubstituted build token in ${relative(root, file)}`,
      );
    for (const match of source.matchAll(
      /\b(?:import|export)(?:[^"'(]*?from)?["']([^"']+\.js)["']/g,
    ))
      pending.push(resolve(file, "..", match[1]));
  }
  return found;
}

/** Check exact generated recovery scopes and both enforced security policies. */
function verifyRecoveryMap(html) {
  try {
    const maps = [
      ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
    ].filter((match) => /\btype=["']importmap["']/.test(match[1]));
    if (maps.length !== 1 || maps[0][1].trim() !== 'type="importmap"')
      throw new Error("Expected one plain inline recovery import map.");
    const [, , text] = maps[0];
    if (html.indexOf(maps[0][0]) > html.search(/<script\b[^>]*type="module"/))
      throw new Error("Recovery map must precede the entry module.");
    const hash = createHash("sha256").update(text).digest("base64");
    const policy = `script-src 'self' 'sha256-${hash}'`;
    const headers = readFileSync(join(root, "_headers"), "utf8");
    const sourceHeaders = readFileSync("public/_headers", "utf8");
    if (headers !== sourceHeaders.replace("script-src 'self'", policy))
      throw new Error(
        "Generated hosting policy differs from the exact map hash or source directives.",
      );
    const metaPolicy = html.match(/content="([^"]*script-src[^"]*)"/)?.[1];
    const sourcePolicy = readFileSync("index.html", "utf8").match(
      /content="([^"]*script-src[^"]*)"/,
    )?.[1];
    if (
      !sourcePolicy ||
      metaPolicy !== sourcePolicy.replace("script-src 'self'", policy)
    )
      throw new Error(
        "Generated meta policy differs from the exact map hash or source directives.",
      );
    const map = JSON.parse(text);
    if (Object.keys(map).sort().join() !== "imports,scopes")
      throw new Error("Unexpected recovery map fields.");
    const manifest = JSON.parse(
      readFileSync(join(root, "asset-manifest.json"), "utf8"),
    );
    const assets = new Set(manifest.assets);
    const validAddress = (address) => {
      if (
        typeof address !== "string" ||
        !/^\.\/assets\/[^/?#]+\.js(?:\?matrixsmith-retry=(?:a1|a[01]f[01]))?$/.test(
          address,
        )
      )
        throw new Error(`Invalid recovery address: ${address}`);
      if (!assets.has(address.split("?")[0]))
        throw new Error(`Recovery asset is not precached: ${address}`);
      return address.split("?")[0];
    };
    const dependencies = (address) => {
      const file = validAddress(address);
      const source = readFileSync(join(root, file), "utf8");
      return [
        ...source.matchAll(
          /\b(?:import|export)(?:[^"'(]*?from)?["']([^"']+\.js)["']/g,
        ),
      ].map(
        (match) => "./" + relative(root, resolve(root, file, "..", match[1])),
      );
    };
    const closure = (address) => {
      const found = new Set();
      const visit = (file) => {
        if (found.has(file)) return;
        found.add(file);
        for (const dependency of dependencies(file)) visit(dependency);
      };
      visit(validAddress(address));
      return found;
    };
    const entry = html.match(/<script[^>]+src=["']([^"']+\.js)["']/)?.[1];
    if (!entry)
      throw new Error("Missing initial entry for recovery validation.");
    const initial = closure(entry);
    const application = closure(map.imports["matrixsmith/application/1"]);
    const aliases = ["matrixsmith/application/1"];
    for (const feature of [
      "ControlView",
      "InvestigationView",
      "DevelopView",
      "ReportDialog",
    ])
      for (const [app, attempt] of [
        [0, 1],
        [1, 0],
        [1, 1],
      ])
        aliases.push(`matrixsmith/${feature}/${app}/${attempt}`);
    if (Object.keys(map.imports).sort().join() !== aliases.sort().join())
      throw new Error("Missing or unbounded recovery entry aliases.");
    const expectedScopes = {};
    const featureOwners = new Map();
    for (const alias of aliases.filter((alias) => alias.endsWith("/0/1")))
      for (const file of closure(map.imports[alias])) {
        if (initial.has(file) || application.has(file)) continue;
        featureOwners.set(file, (featureOwners.get(file) ?? 0) + 1);
      }
    if ([...featureOwners.values()].some((owners) => owners > 1))
      throw new Error(
        "Shared feature modules must belong to the preserved application graph.",
      );
    for (const alias of aliases) {
      const address = map.imports[alias];
      const parts = alias.split("/");
      const app = parts[1] === "application" ? 1 : Number(parts[2]);
      const featureRevision =
        parts[1] === "application" ? "" : `a${app}f${parts[3]}`;
      const revisionFor = (file) =>
        initial.has(file)
          ? ""
          : application.has(file)
            ? app
              ? "a1"
              : ""
            : featureRevision;
      const revised = (file) =>
        file +
        (revisionFor(file) ? `?matrixsmith-retry=${revisionFor(file)}` : "");
      if (address !== revised(validAddress(address)))
        throw new Error(`Incorrect entry revision: ${alias}`);
      for (const file of closure(address)) {
        if (!revisionFor(file)) continue;
        expectedScopes[revised(file)] = Object.fromEntries(
          dependencies(file).map((dependency) => [
            dependency,
            revised(dependency),
          ]),
        );
      }
    }
    const normalized = (scopes) =>
      JSON.stringify(
        Object.entries(scopes)
          .sort()
          .map(([key, values]) => [key, Object.entries(values).sort()]),
      );
    for (const [scope, mappings] of Object.entries(map.scopes)) {
      validAddress(scope);
      for (const [specifier, target] of Object.entries(mappings)) {
        validAddress(specifier);
        validAddress(target);
      }
    }
    if (normalized(map.scopes) !== normalized(expectedScopes))
      throw new Error(
        "Recovery scopes do not match the static graph and preserved application identity.",
      );
    console.log(
      `Recovery import map: ${aliases.length} finite entries; exact CSP hash and static graph verified.`,
    );
  } catch (error) {
    failures.push(`Invalid module recovery output: ${String(error)}`);
  }
}
