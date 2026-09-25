export interface BuildIdentity {
  readonly version: string;
  readonly buildId: string;
  readonly commit: string;
}
export function buildIdentity(): BuildIdentity;
