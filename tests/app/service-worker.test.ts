import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { createSourceInstrumenter } from "../../scripts/source-coverage.mjs";
import { describe, expect, it } from "vitest";

const rawSource = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);
const coverageGlobal = globalThis as unknown as {
  __coverage__?: Record<string, unknown>;
};
const instrumented = process.env.VITE_COVERAGE === "true";
if (instrumented) coverageGlobal.__coverage__ ??= {};
const source: string = instrumented
  ? createSourceInstrumenter().instrumentSync(
      rawSource,
      resolve("public/sw.js"),
    )
  : rawSource;
const origin = "https://matrixsmith.test/";
function harness() {
  const data = new Map<string, Map<string, Response>>();
  let broken = "";
  const key = (request: Request | string): string =>
    new URL(typeof request === "string" ? request : request.url, origin).href;
  const caches = {
    keys: async () => [...data.keys()],
    delete: async (name: string) => data.delete(name),
    async open(name: string) {
      let values = data.get(name);
      if (!values) {
        values = new Map();
        data.set(name, values);
      }
      const store = values;
      return {
        match: async (request: Request | string) =>
          store.get(key(request))?.clone(),
        put: async (request: Request | string, response: Response) => {
          store.set(key(request), response.clone());
        },
        addAll: async (requests: (Request | string)[]) => {
          for (const request of requests) {
            if (key(request).includes(broken) && broken)
              throw new Error("offline");
            store.set(key(request), new Response(key(request)));
          }
        },
      };
    },
    async match(request: Request | string) {
      for (const store of data.values()) {
        const value = store.get(key(request));
        if (value) return value.clone();
      }
      return undefined;
    },
  };
  function worker(build: string) {
    const listeners = new Map<
      string,
      (event: Record<string, unknown>) => void
    >();
    runInNewContext(
      source
        .replaceAll("__MATRIXSMITH_BUILD_ID__", build)
        .replace(
          /(const ASSETS = [^\n]*?)\[\]/,
          (_match: string, prefix: string) =>
            prefix +
            JSON.stringify([
              `./assets/${build}.js`,
              `./assets/${build}-lazy.js`,
            ]),
        ),
      {
        self: {
          location: { href: origin + "sw.js", origin: new URL(origin).origin },
          clients: { matchAll: async () => [], claim: async () => {} },
          skipWaiting: async () => {},
          addEventListener: (
            name: string,
            fn: (event: Record<string, unknown>) => void,
          ) => listeners.set(name, fn),
        },
        __coverage__: coverageGlobal.__coverage__,
        caches,
        URL,
        Request,
        Response,
        MessageChannel,
        setTimeout,
        clearTimeout,
        fetch: async (request: Request) =>
          new Response(
            request.url.endsWith("build-metadata.json") ||
              request.url.endsWith("asset-manifest.json")
              ? JSON.stringify({ buildId: build })
              : request.url.endsWith("index.html")
                ? `<script src="./assets/${build}.js"></script>`
                : request.url,
          ),
      },
    );
    return {
      async event(name: string) {
        let pending: Promise<unknown> | undefined;
        listeners.get(name)?.({
          waitUntil: (promise: Promise<unknown>) => {
            pending = promise;
          },
        });
        await pending;
      },
      async navigate() {
        let response: Promise<Response> | undefined;
        listeners.get("fetch")?.({
          request: { method: "GET", mode: "navigate", url: origin },
          respondWith: (value: Promise<Response>) => {
            response = value;
          },
        });
        return response;
      },
    };
  }
  return {
    worker,
    data,
    breakOn: (value: string) => {
      broken = value;
    },
  };
}

describe("version-consistent offline worker", () => {
  it("serves the installed shell without depending on the network", async () => {
    const h = harness(),
      a = h.worker("a");
    await a.event("install");
    await a.event("activate");
    expect(await (await a.navigate())?.text()).toContain("assets/a.js");
    expect(
      h.data.get("matrixsmith-assets-a")?.has(origin + "assets/a-lazy.js"),
    ).toBe(true);
  });
  it("a failed new installation preserves the previous complete build", async () => {
    const h = harness(),
      a = h.worker("a");
    await a.event("install");
    await a.event("activate");
    h.breakOn("b-lazy");
    await expect(h.worker("b").event("install")).rejects.toThrow("offline");
    expect(h.data.has("matrixsmith-shell-b")).toBe(false);
    expect(h.data.has("matrixsmith-assets-b")).toBe(false);
    expect(await (await a.navigate())?.text()).toContain("assets/a.js");
  });
  it("retains current and previous builds while leaving unrelated caches alone", async () => {
    const h = harness();
    h.data.set("another-app", new Map());
    for (const build of ["a", "b", "c"]) {
      const worker = h.worker(build);
      await worker.event("install");
      await worker.event("activate");
    }
    expect([...h.data.keys()].sort()).toEqual([
      "another-app",
      "matrixsmith-assets-b",
      "matrixsmith-assets-c",
      "matrixsmith-releases",
      "matrixsmith-shell-b",
      "matrixsmith-shell-c",
    ]);
  });
});
