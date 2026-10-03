import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { AppSnapshot, PresentationStore } from "../../presentation/store";
import type { AdvisoryResolution } from "../../knowledge/resolver";
import type { KnowledgeCorpus } from "../../knowledge/types";

interface ViewState {
  requested: boolean;
  query: string;
  result: AdvisoryResolution | null;
  corpus: KnowledgeCorpus | null;
  error: string | null;
}
const retained = new WeakMap<object, ViewState>();
const empty = (): ViewState => ({
  requested: false,
  query: "",
  result: null,
  corpus: null,
  error: null,
});

export function AdvisoryKnowledge({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element | null {
  const input = snapshot.advisoryInput;
  const [view, setView] = useState<ViewState>(() =>
    input ? (retained.get(input.owner) ?? empty()) : empty(),
  );
  const [context, setContext] = useState({
    owner: input?.owner,
    fingerprint: input?.fingerprint,
  });
  const actions = input?.actions.join("|") ?? "";
  useEffect(() => {
    let active = true;
    const state = input ? (retained.get(input.owner) ?? empty()) : empty();
    setContext({ owner: input?.owner, fingerprint: input?.fingerprint });
    setView({ ...state, result: null });
    if (input && state.requested) {
      void import("../../knowledge/load")
        .then(async (module) => {
          const [result, corpus] = await Promise.all([
            module.projectKnowledge(
              input.owner,
              input.fingerprint,
              input.actions,
            ),
            module.loadKnowledge(),
          ]);
          if (active) {
            const next = { ...state, result, corpus, error: null };
            retained.set(input.owner, next);
            setView(next);
          }
        })
        .catch((error) => {
          if (active) setView({ ...state, error: String(error) });
        });
    }
    return () => {
      active = false;
    };
  }, [input?.owner, input?.fingerprint, actions, view.requested]);
  if (!input) return null;
  const visible =
    context.owner === input.owner && context.fingerprint === input.fingerprint
      ? view
      : {
          ...(retained.get(input.owner) ?? empty()),
          result: null,
          corpus: null,
        };
  const request = () => {
    const next = { ...visible, requested: true };
    retained.set(input.owner, next);
    setView(next);
  };
  const results =
    visible.corpus && visible.query.trim()
      ? visible.corpus.records
          .filter((record) => {
            const term = visible.query.slice(0, 256).toLowerCase();
            const alias =
              visible.corpus!.aliases.find((a) => a.from === term)?.to ?? term;
            return [
              record.label,
              record.id,
              record.notes,
              ...record.aliases,
              ...record.families,
            ].some((value) => value.toLowerCase().includes(alias));
          })
          .slice(0, 8)
      : [];
  return (
    <section
      class="secondary-section knowledge-advisory"
      aria-labelledby="advisory-title"
    >
      <h2 id="advisory-title">Prior protocol knowledge</h2>
      <p>
        Public-source context is advisory. It establishes no support claim or
        permission to send.
      </p>
      {!visible.requested ? (
        <button class="secondary" onClick={request}>
          Explain plausible families
        </button>
      ) : (
        <>
          {visible.error && <p role="alert">{visible.error}</p>}
          {!visible.result && !visible.error && (
            <p role="status">Loading local reference data…</p>
          )}
          {visible.result && (
            <>
              <p>{visible.result.summary}</p>
              {visible.result.families.map((family) => (
                <div key={family.id}>
                  <h3>{family.label}</h3>
                  <p>{family.unknowns[0]}</p>
                  {family.contradictions.map((reason) => (
                    <p key={reason}>Exact-profile contradiction: {reason}</p>
                  ))}
                  {family.reviewedActions.length > 0 && (
                    <button
                      class="text-action"
                      onClick={() => store.setView("diagnose")}
                    >
                      Review registered identification action
                    </button>
                  )}
                  <details>
                    <summary>
                      Supporting facts and sources for {family.label}
                    </summary>
                    <ul>
                      {family.facts.map((fact) => (
                        <li key={fact.id}>
                          <p>
                            {fact.basis} · {fact.scope}: {fact.text}
                          </p>
                          <ul>
                            {fact.evidence.map((ref) => {
                              const source = family.sources.find(
                                (s) => s.id === ref.sourceId,
                              );
                              return (
                                <li key={`${ref.sourceId}:${ref.locator}`}>
                                  {source?.url ? (
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {source.attribution}
                                    </a>
                                  ) : (
                                    ref.sourceId
                                  )}{" "}
                                  · {ref.locator} · revision{" "}
                                  {source?.revision ?? "unversioned"} ·{" "}
                                  {source?.status} · license metadata{" "}
                                  {source?.license ??
                                    "unknown; review required"}
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    <ul>
                      {family.unknowns.slice(1).map((unknown) => (
                        <li key={unknown}>{unknown}</li>
                      ))}
                    </ul>
                    {visible.corpus?.conflicts
                      .filter((conflict) =>
                        conflict.sources.some((id) =>
                          family.sources.some((source) => source.id === id),
                        ),
                      )
                      .slice(0, 4)
                      .map((conflict) => (
                        <p key={conflict.id}>
                          Source conflict: {conflict.text}
                        </p>
                      ))}
                  </details>
                </div>
              ))}
              <p>{visible.result.unknowns.join(" ")}</p>
              <details>
                <summary>
                  Search the reference index · {visible.corpus?.records.length}{" "}
                  records
                </summary>
                <label>
                  Reference search
                  <input
                    value={visible.query}
                    maxLength={256}
                    onInput={(event) => {
                      const next = {
                        ...visible,
                        query: event.currentTarget.value,
                      };
                      retained.set(input.owner, next);
                      setView(next);
                    }}
                  />
                </label>
                <p>
                  Includes unresolved and reference-only lines. At most eight
                  results.
                </p>
                <ul>
                  {results.map((record) => (
                    <li key={record.id}>
                      <strong>{record.label}</strong>
                      <p>
                        {record.families.join(", ")} · family applicability is a
                        research candidate relationship.
                      </p>
                      <p>{record.notes}</p>
                      <details>
                        <summary>Index references</summary>
                        {record.references.map((ref) => {
                          const source = visible.corpus!.sources.find(
                            (s) => s.id === ref.sourceId,
                          );
                          return (
                            <p key={`${ref.sourceId}:${ref.locator}`}>
                              {source?.url ? (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {source.attribution}
                                </a>
                              ) : (
                                ref.sourceId
                              )}{" "}
                              · {ref.locator}
                            </p>
                          );
                        })}
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
