import instrument from "istanbul-lib-instrument";

/** Instrument original source identically in Node and the browser, before either
 * pipeline rewrites JSX/imports. This prevents duplicate, mismatched counters. */
export function createSourceInstrumenter() {
  return instrument.createInstrumenter({
    esModules: true,
    produceSourceMap: true,
    compact: false,
    parserPlugins: ["typescript", "jsx"],
    coverageGlobalScope: "globalThis",
    coverageGlobalScopeFunc: false,
  });
}
export function sourceCoveragePlugin() {
  return {
    name: "matrixsmith-test-coverage",
    enforce: "pre",
    apply: "serve",
    transform(code, id) {
      const file = id.split("?")[0];
      if (
        !file.includes("/src/") ||
        !/\.(ts|tsx)$/.test(file) ||
        file.endsWith(".d.ts")
      )
        return;
      const instrumenter = createSourceInstrumenter();
      return {
        code: instrumenter.instrumentSync(code, file),
        map: instrumenter.lastSourceMap(),
      };
    },
  };
}
