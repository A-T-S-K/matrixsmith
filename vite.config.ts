import { sourceCoveragePlugin } from "./scripts/source-coverage.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildIdentity } from "./scripts/build-identity.mjs";
import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv, minify } from "vite";

// Vite's dev server injects styles inline and needs a WebSocket for HMR, which
// the strict production CSP forbids. Relax exactly those two directives for
// `vite dev` only; builds ship the unmodified index.html policy.
const devCsp: Plugin = {
  name: "matrixsmith-dev-csp",
  apply: "serve",
  transformIndexHtml: (html) =>
    html
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws: wss:"),
};

/** Gives the service worker a build-time list of lazy chunks for first-install offline use. */
const identity = buildIdentity();
const offlineAssetManifest: Plugin = {
  name: "matrixsmith-offline-asset-manifest",
  apply: "build",
  enforce: "post",
  async generateBundle(_options, bundle) {
    const chunks = new Map(
      Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .map((chunk) => [chunk.fileName, chunk]),
    );
    const rootFor = (suffix: string): string => {
      const root = [...chunks.values()].find((chunk) =>
        chunk.facadeModuleId?.endsWith(suffix),
      );
      if (!root) this.error(`Missing recovery entry: ${suffix}`);
      return root.fileName;
    };
    const closure = (root: string, includeDynamic = false): Set<string> => {
      const found = new Set<string>();
      const visit = (file: string): void => {
        if (found.has(file)) return;
        found.add(file);
        for (const dependency of chunks.get(file)?.imports ?? [])
          visit(dependency);
        if (includeDynamic && !initial.has(file))
          for (const dependency of chunks.get(file)?.dynamicImports ?? [])
            if (!featureEntries.has(dependency)) visit(dependency);
      };
      visit(root);
      return found;
    };
    const initialEntry = [...chunks.values()].find((chunk) => chunk.isEntry);
    if (!initialEntry) this.error("Missing initial application entry");
    const initial = closure(initialEntry.fileName);
    const features = (
      [
        ["ControlView", "/src/ui/views/ControlView.tsx"],
        ["InvestigationView", "/src/ui/views/InvestigationView.tsx"],
        ["DevelopView", "/src/ui/views/DevelopView.tsx"],
        ["ReportDialog", "/src/ui/components/report/ReportDialog.tsx"],
      ] as const
    ).map(([name, suffix]) => [name, rootFor(suffix)] as const);
    const featureEntries = new Set(features.map(([, entry]) => entry));
    const application = rootFor("/src/application-bootstrap.tsx");
    // Lazy helper branches must retain the successful application revision too.
    // Traversing their metadata does not download or execute them eagerly.
    const applicationGraph = closure(application, true);
    const imports: Record<string, string> = {};
    const scopes: Record<string, Record<string, string>> = {};
    const address = (file: string, revision: string): string =>
      `./${file}${revision ? `?matrixsmith-retry=${revision}` : ""}`;
    const addGraph = (
      alias: string,
      entry: string,
      appAttempt: number,
      featureRevision?: string,
    ): void => {
      const revisionFor = (file: string): string => {
        if (initial.has(file)) return "";
        if (applicationGraph.has(file))
          return appAttempt ? `a${appAttempt}` : "";
        if (featureEntries.has(file))
          return featureRevision ?? (appAttempt ? `a${appAttempt}f0` : "");
        return featureRevision ?? "";
      };
      imports[alias] = address(entry, revisionFor(entry));
      for (const file of closure(entry, true)) {
        const revision = revisionFor(file);
        if (!revision) continue;
        const mappings = Object.fromEntries(
          [
            ...(chunks.get(file)?.imports ?? []),
            ...(chunks.get(file)?.dynamicImports ?? []),
          ].map((dependency) => [
            address(dependency, ""),
            address(
              dependency,
              applicationGraph.has(file) && featureEntries.has(dependency)
                ? appAttempt
                  ? `a${appAttempt}f0`
                  : ""
                : revisionFor(dependency),
            ),
          ]),
        );
        const scope = address(file, revision);
        if (
          scopes[scope] &&
          JSON.stringify(scopes[scope]) !== JSON.stringify(mappings)
        )
          this.error(`Conflicting recovery scope: ${scope}`);
        scopes[scope] = mappings;
      }
    };
    // One explicit recovery attempt. Every referring chunk has an exact URL
    // scope: a fresh entry alone cannot repair a cached failed static child.
    for (let attempt = 1; attempt <= 1; attempt++)
      addGraph(`matrixsmith/application/${attempt}`, application, attempt);
    for (const [name, entry] of features) {
      for (let appAttempt = 0; appAttempt <= 1; appAttempt++)
        for (let attempt = 0; attempt <= 1; attempt++) {
          if (!appAttempt && !attempt) continue;
          addGraph(
            `matrixsmith/${name}/${appAttempt}/${attempt}`,
            entry,
            appAttempt,
            `a${appAttempt}f${attempt}`,
          );
        }
    }
    const map = JSON.stringify({ imports, scopes });
    const hash = createHash("sha256").update(map).digest("base64");
    const policy = `script-src 'self' 'sha256-${hash}'`;
    const html = bundle["index.html"];
    if (!html || html.type !== "asset") this.error("Missing recovery shell");
    html.source = String(html.source)
      .replace("script-src 'self'", policy)
      .replace(
        /(<script\b[^>]*type="module")/,
        `<script type="importmap">${map}</script>\n$1`,
      );
    this.emitFile({
      type: "asset",
      fileName: "_headers",
      source: readFileSync("public/_headers", "utf8").replace(
        "script-src 'self'",
        policy,
      ),
    });
    this.emitFile({
      type: "asset",
      fileName: "third-party-notices.txt",
      source: readFileSync("THIRD_PARTY_NOTICES.md", "utf8"),
    });
    const assets = Object.values(bundle)
      .map((output) => `./${output.fileName}`)
      .filter((file) => file.startsWith("./assets/"))
      .sort();
    this.emitFile({
      type: "asset",
      fileName: "build-metadata.json",
      source: JSON.stringify(identity),
    });
    // Emitted assets bypass chunk minification. Use the existing build
    // toolchain for the worker too, after substituting its complete manifest.
    const worker = await minify(
      "sw.js",
      readFileSync("public/sw.js", "utf8")
        .replaceAll("__MATRIXSMITH_BUILD_ID__", identity.buildId)
        .replace("/* __MATRIXSMITH_ASSETS__ */ []", JSON.stringify(assets)),
      { module: false },
    );
    if (worker.errors[0]) this.error(worker.errors[0].message);
    this.emitFile({
      type: "asset",
      fileName: "sw.js",
      source: worker.code,
    });
    this.emitFile({
      type: "asset",
      fileName: "asset-manifest.json",
      source: JSON.stringify({ buildId: identity.buildId, assets }),
    });
  },
};

export default defineConfig(({ mode }) => {
  const host = loadEnv(
    mode,
    ".",
    "MATRIXSMITH_",
  ).MATRIXSMITH_TUNNEL_HOST?.trim();
  return {
    base: "./",
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                // Shared advisory UI retains state across feature routes. Keep
                // it in the successful application graph during view recovery.
                name: "application-runtime",
                test: /\/src\/(?:presentation\/store\.ts|ui\/components\/AdvisoryKnowledge\.tsx)$/,
                includeDependenciesRecursively: false,
              },
              {
                // These standalone validators share generated runtime code.
                // A single lazy chunk compresses it across schema boundaries.
                name: "evidence-validators",
                test: /\/src\/(?:diagnostics|profiles|knowledge)\/generated\/(?:bundle|profile|knowledge)-validator\.js$/,
                includeDependenciesRecursively: true,
              },
            ],
          },
        },
      },
    },
    define: {
      __MATRIXSMITH_VERSION__: JSON.stringify(
        `${identity.version}+${identity.buildId}`,
      ),
    },
    plugins: [
      devCsp,
      offlineAssetManifest,
      ...(process.env.VITE_COVERAGE === "true" && mode !== "production"
        ? [sourceCoveragePlugin()]
        : []),
    ],
    // Cloudflare quick tunnels get a new random subdomain on every launch.
    // Trust only that domain suffix so relaunches do not require config edits.
    server: {
      port: 5174,
      strictPort: true,
      allowedHosts: [".trycloudflare.com", ...(host ? [host] : [])],
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      setupFiles:
        process.env.VITE_COVERAGE === "true"
          ? ["tests/helpers/coverage-setup.ts"]
          : [],
    },
  };
});
