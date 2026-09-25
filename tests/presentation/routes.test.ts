import { describe, expect, it, vi } from "vitest";
import {
  createHashRouter,
  parseRoute,
} from "../../src/presentation/app/routes";

describe("static hash routes", () => {
  it("parses deep links and safely falls back home", () => {
    expect(parseRoute("#/device/investigate").id).toBe("investigate");
    expect(parseRoute("#/missing").id).toBe("home");
  });

  it("uses browser history without changing any connection state", () => {
    const listeners = new Map<string, () => void>();
    const location = { hash: "#/home" } as Location;
    const history = {
      pushState: vi.fn((_state, _unused, url) => {
        location.hash = String(url);
      }),
      replaceState: vi.fn((_state, _unused, url) => {
        location.hash = String(url);
      }),
    } as unknown as History;
    const router = createHashRouter({
      location,
      history,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => listeners.set(type, listener as () => void),
      removeEventListener: vi.fn(),
    });
    const visited: string[] = [];
    router.subscribe(({ id }) => visited.push(id));
    router.navigate("create");
    expect(history.pushState).toHaveBeenCalledWith(null, "", "#/device/create");
    expect(visited).toEqual(["create"]);
  });
});
