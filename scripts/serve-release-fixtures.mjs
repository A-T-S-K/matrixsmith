import { createServer } from "node:http";
import {
  mkdtempSync,
  cpSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { execFileSync } from "node:child_process";

const temporary = mkdtempSync(join(tmpdir(), "matrixsmith-release-tests-"));
const source = join(temporary, "source");
for (const path of [
  "src",
  "public",
  "scripts",
  "index.html",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
  ".nvmrc",
])
  cpSync(resolve(path), join(source, path), { recursive: true });
symlinkSync(resolve("node_modules"), join(source, "node_modules"), "dir");
// A source change, rather than a mocked worker, produces the second real build.
for (const version of ["a", "b"]) {
  const marker = join(source, "src/application/version.ts");
  if (version === "b")
    writeFileSync(
      marker,
      readFileSync(marker, "utf8") + "\n// Production upgrade fixture B.\n",
    );
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "build",
      "--outDir",
      join(temporary, version),
    ],
    { cwd: source, stdio: "inherit" },
  );
}
let active = "a",
  broken = false;
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/__test/unresponsive") {
    response
      .writeHead(200, { "Content-Type": "text/html" })
      .end("<!doctype html><title>Idle test tab</title>");
    return;
  }
  if (url.pathname.startsWith("/__test/release/")) {
    const version = url.pathname.split("/").at(-1);
    if (!["a", "b"].includes(version)) {
      response.writeHead(400).end();
      return;
    }
    active = version;
    broken = url.searchParams.has("broken");
    response.writeHead(200, { "Cache-Control": "no-store" }).end(active);
    return;
  }
  const root = join(temporary, active);
  const path = resolve(
    root,
    "." +
      decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
  );
  if (!path.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  if (
    broken &&
    url.pathname.includes("/assets/") &&
    !url.pathname.endsWith(".css")
  ) {
    response.writeHead(503).end();
    return;
  }
  try {
    if (!statSync(path).isFile()) throw new Error("Not a file");
    response
      .writeHead(200, {
        "Content-Type": types[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(readFileSync(path));
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(4174, "127.0.0.1");
const close = () =>
  server.close(() => {
    rmSync(temporary, { recursive: true, force: true });
    process.exit(0);
  });
process.on("SIGTERM", close);
process.on("SIGINT", close);
server.on("error", (error) => {
  console.error(error);
  rmSync(temporary, { recursive: true, force: true });
  process.exit(1);
});
