interface StructuralError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly message?: string;
}
declare const validate: {
  (input: unknown): boolean;
  validateDateTime(input: string): boolean;
  errors?: readonly StructuralError[] | null;
};
export default validate;
