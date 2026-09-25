import { describe, expect, it } from "vitest";
import { PRIMARY_NAV } from "../../src/ui/pages/DeviceWorkspace";

describe("workspace navigation", () => {
  it("keeps Create and Investigate as the only primary navigation items", () => {
    expect(PRIMARY_NAV.map(([id]) => id)).toEqual(["control", "diagnose"]);
  });

  it("does not place the protocol workbench in primary/bottom navigation", () => {
    expect(PRIMARY_NAV.map(([id]) => id)).not.toContain("develop");
  });
});
