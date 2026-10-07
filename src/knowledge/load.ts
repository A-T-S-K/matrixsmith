import validate from "./generated/knowledge-validator.js";
import { freezeDefinition } from "../profiles/freeze";
import { validateKnowledgeReferences } from "./validation";
import { resolveKnowledge } from "./resolver";
import type { KnowledgeCorpus } from "./types";
import type { DeviceFingerprint } from "../core/device";

let pending: Promise<KnowledgeCorpus> | null = null;
export function loadKnowledge(): Promise<KnowledgeCorpus> {
  if (!pending)
    pending = fetch(`${import.meta.env.BASE_URL}knowledge-v1.json`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Advisory reference data is unavailable.");
        const text = await response.text();
        if (
          text.length > 262144 ||
          new TextEncoder().encode(text).length > 262144
        )
          throw new Error("Reference data exceeds its byte budget.");
        const value: unknown = JSON.parse(text);
        if (!validate(value))
          throw new Error("Advisory reference format is incompatible.");
        const corpus = value as KnowledgeCorpus;
        validateKnowledgeReferences(corpus);
        return freezeDefinition(corpus);
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  return pending;
}

// A workspace owner and its immutable fingerprint define projection lifetime.
const projections = new WeakMap<
  object,
  {
    fingerprint: DeviceFingerprint;
    actions: string;
    result: ReturnType<typeof resolveKnowledge>;
  }
>();
export async function projectKnowledge(
  owner: object,
  fingerprint: DeviceFingerprint,
  actions: readonly string[],
) {
  const corpus = await loadKnowledge();
  const key = actions.join("|");
  const previous = projections.get(owner);
  if (previous?.fingerprint === fingerprint && previous.actions === key)
    return previous.result;
  const result = freezeDefinition(
    resolveKnowledge(corpus, fingerprint, actions),
  );
  projections.set(owner, { fingerprint, actions: key, result });
  return result;
}
