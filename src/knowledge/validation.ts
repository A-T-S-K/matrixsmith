import type { KnowledgeCorpus } from "./types";

/** Structural validation precedes this semantic pass. Also used at build time. */
export function validateKnowledgeReferences(corpus: KnowledgeCorpus): void {
  const index = <T extends { readonly id: string }>(rows: readonly T[]) => {
    const ids = new Set(rows.map((row) => row.id));
    if (ids.size !== rows.length)
      throw new Error("Duplicate knowledge identity.");
    return ids;
  };
  const families = index(corpus.families),
    sheets = index(corpus.sheets),
    sources = index(corpus.sources),
    assertions = index(corpus.assertions),
    conflicts = index(corpus.conflicts);
  index(corpus.records);
  const requireRef = (ids: Set<string>, id: string) => {
    if (!ids.has(id)) throw new Error(`Dangling knowledge reference: ${id}.`);
  };
  const aliases = new Set<string>();
  for (const alias of corpus.aliases) {
    if (aliases.has(alias.from) || families.has(alias.from))
      throw new Error("Conflicting knowledge alias.");
    aliases.add(alias.from);
    requireRef(families, alias.to);
  }
  for (const family of corpus.families) {
    if (family.sheetId) requireRef(sheets, family.sheetId);
    if (family.match) {
      requireRef(assertions, family.match.assertionId);
      const assertion = corpus.assertions.find(
        (a) => a.id === family.match!.assertionId,
      )!;
      if (
        assertion.familyId !== family.id ||
        assertion.field !== "gatt" ||
        !["specified", "implemented"].includes(assertion.basis)
      )
        throw new Error("Unsupported matching assertion.");
    }
  }
  for (const sheet of corpus.sheets) requireRef(families, sheet.familyId);
  for (const record of corpus.records) {
    record.families.forEach((id) => requireRef(families, id));
    record.references.forEach((ref) => requireRef(sources, ref.sourceId));
  }
  for (const assertion of corpus.assertions) {
    requireRef(families, assertion.familyId);
    assertion.evidence.forEach((ref) => requireRef(sources, ref.sourceId));
    assertion.conflicts.forEach((id) => requireRef(conflicts, id));
  }
  for (const conflict of corpus.conflicts)
    conflict.sources.forEach((id) => requireRef(sources, id));
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) throw new Error("Copied-source lineage cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of corpus.sources.find((s) => s.id === id)!.derivedFrom) {
      requireRef(sources, parent);
      walk(parent);
    }
    visiting.delete(id);
    visited.add(id);
  };
  corpus.sources.forEach((s) => walk(s.id));
}

/** Count connected research origins conservatively; copies are not corroboration. */
export function independentOrigins(
  corpus: KnowledgeCorpus,
  sourceIds: readonly string[],
): number {
  const groups = new Map(corpus.sources.map((s) => [s.id, s.origin]));
  for (let pass = 0; pass < corpus.sources.length; pass++) {
    let changed = false;
    for (const source of corpus.sources)
      for (const parent of source.derivedFrom) {
        const a = groups.get(source.id)!,
          b = groups.get(parent)!;
        const shared = a < b ? a : b;
        if (a !== b) {
          for (const [id, origin] of groups)
            if (origin === a || origin === b) groups.set(id, shared);
          changed = true;
        }
      }
    if (!changed) break;
  }
  return new Set(sourceIds.map((id) => groups.get(id))).size;
}
