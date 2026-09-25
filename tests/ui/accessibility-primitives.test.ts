import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string): string =>
  readFileSync(
    new URL(`../../src/ui/components/${name}.tsx`, import.meta.url),
    "utf8",
  );

const featureSource = (name: string): string =>
  readFileSync(new URL(`../../src/ui/${name}`, import.meta.url), "utf8");

describe("shared accessibility primitives", () => {
  it("Dialog contains focus, closes on Escape, inerts the app, and restores focus", () => {
    const dialog = source("Dialog");
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain('event.key !== "Tab"');
    expect(dialog).toContain("background.inert = true");
    expect(dialog).toContain("previouslyFocused.focus()");
    expect(dialog).toContain('aria-modal="true"');
  });

  it("Tabs implements relationships, roving focus, and the standard navigation keys", () => {
    const tabs = source("Tabs");
    for (const token of [
      'role="tablist"',
      'role="tab"',
      'role="tabpanel"',
      "aria-controls",
      "aria-labelledby",
      "aria-selected",
      "tabIndex",
    ])
      expect(tabs).toContain(token);
    for (const key of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ])
      expect(tabs).toContain(key);
  });

  it("uses disclosure buttons, visible unavailable reasons, and a non-focusable file input", () => {
    expect(source("MenuButton")).not.toContain('role="menu"');
    expect(source("MenuButton")).toContain("aria-expanded");
    expect(source("UnavailableAction")).toContain("unavailable-reason");
    expect(source("FileButton")).toContain("tabIndex={-1}");
    expect(source("NoticeRegion")).toContain(
      'aria-label="Dismiss notification"',
    );
  });

  it("does not put disabled-action explanations in title attributes", () => {
    for (const file of [
      "features/control/DeviceControls.tsx",
      "features/investigation/ActionSections.tsx",
      "features/investigation/CatalogueSections.tsx",
      "features/investigation/DeveloperTools.tsx",
      "features/develop/CandidateTools.tsx",
      "features/develop/GattSection.tsx",
    ]) {
      expect(featureSource(file), file).not.toContain("title=");
      expect(featureSource(file), file).toContain("UnavailableAction");
    }
  });
});
