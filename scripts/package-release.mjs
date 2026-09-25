import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

function requireClean() {
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();
  if (status)
    throw new Error(
      "Release packaging requires a reviewed, committed working tree. Commit intended changes or remove unrelated files; no dirty-tree override is provided.",
    );
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}
const commit = requireClean();
if (process.argv.includes("--check")) {
  console.log(`Clean candidate source: ${commit}`);
} else {
  execFileSync("npm", ["run", "verify:release"], { stdio: "inherit" });
  if (requireClean() !== commit)
    throw new Error("Candidate source changed during verification.");
  const metadata = JSON.parse(readFileSync("dist/build-metadata.json", "utf8"));
  if (metadata.commit !== commit)
    throw new Error("Built artifact does not match the candidate commit.");
  const files = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name),
        stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile())
        files[path.slice("dist/".length)] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
      else throw new Error(`Unsupported artifact entry: ${path}`);
    }
  }
  visit("dist");
  mkdirSync("release", { recursive: true });
  const base = `matrixsmith-${metadata.version}-${metadata.buildId}`;
  const archive = resolve("release", `${base}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", "dist", "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const sha256 = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeFileSync(
    `release/${base}.json`,
    JSON.stringify(
      { ...metadata, archive: `${base}.tar.gz`, sha256, files },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(`release/${base}.sha256`, `${sha256}  ${base}.tar.gz\n`);
  console.log(`Verified candidate artifact: ${archive}`);
}
