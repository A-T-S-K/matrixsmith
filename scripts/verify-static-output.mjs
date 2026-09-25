import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

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
];
const failures = [];
const INITIAL_ROUTE_JS_GZIP_LIMIT = 90 * 1024;
const TOTAL_JS_GZIP_LIMIT = 180 * 1024;
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
    const withoutMarkupNamespaces = source
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
