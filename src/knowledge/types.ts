export interface Citation {
  readonly sourceId: string;
  readonly locator: string;
}
export interface KnowledgeSource {
  readonly id: string;
  readonly url: string | null;
  readonly origin: string;
  readonly derivedFrom: readonly string[];
  readonly attribution: string;
  readonly revision: string | null;
  readonly sha256: string | null;
  readonly license: string | null;
  readonly retrieved: string;
  readonly status: string;
}
export interface KnowledgeAssertion {
  readonly id: string;
  readonly familyId: string;
  readonly field: string;
  readonly text: string;
  readonly scope: string;
  readonly basis:
    | "specified"
    | "implemented"
    | "author-observed"
    | "corroborated"
    | "hypothesis"
    | "unknown";
  readonly evidence: readonly Citation[];
  readonly conflicts: readonly string[];
}
export interface KnowledgeFamily {
  readonly id: string;
  readonly label: string;
  readonly sheetId: string | null;
  readonly resolution: "documented-line" | "unresolved";
  readonly unknowns: readonly string[];
  readonly match: {
    readonly serviceUuid: string | null;
    readonly characteristicUuids: readonly string[];
    readonly assertionId: string;
  } | null;
}
export interface KnowledgeCorpus {
  readonly version: 1;
  readonly revision: string;
  readonly redistribution: string;
  readonly aliases: readonly { readonly from: string; readonly to: string }[];
  readonly families: readonly KnowledgeFamily[];
  readonly sheets: readonly {
    readonly id: string;
    readonly familyId: string;
    readonly label: string;
  }[];
  readonly records: readonly {
    readonly id: string;
    readonly label: string;
    readonly scope: string;
    readonly families: readonly string[];
    readonly aliases: readonly string[];
    readonly notes: string;
    readonly unknowns: readonly string[];
    readonly references: readonly Citation[];
  }[];
  readonly assertions: readonly KnowledgeAssertion[];
  readonly sources: readonly KnowledgeSource[];
  readonly conflicts: readonly {
    readonly id: string;
    readonly text: string;
    readonly sources: readonly string[];
  }[];
}
