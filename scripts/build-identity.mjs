import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export function buildIdentity() {
  const hash = createHash("sha256");
  const visit = (path) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else {
      hash.update(path);
      hash.update("\0");
      hash.update(readFileSync(path));
    }
  };
  for (const path of [
    "index.html",
    "THIRD_PARTY_NOTICES.md",
    "src",
    "public",
    "scripts",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "tsconfig.app.json",
    "tsconfig.json",
    "tsconfig.node.json",
    ".nvmrc",
  ])
    visit(path);
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  let commit = "uncommitted";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* Source archives may not include Git metadata. */
  }
  return { version, buildId: hash.digest("hex").slice(0, 16), commit };
}
