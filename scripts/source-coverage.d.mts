import type { Plugin } from "vite";
export function sourceCoveragePlugin(): Plugin;
export function createSourceInstrumenter(): {
  instrumentSync(code: string, filename: string): string;
  lastFileCoverage(): unknown;
  lastSourceMap(): unknown;
};
