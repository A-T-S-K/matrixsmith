/** One owner-local entry. Keys contain only actual content inputs and lifetime identity. */
export class ContentCache<T> {
  private entry: { inputs: readonly unknown[]; value: T } | null = null;
  get(inputs: readonly unknown[], build: () => T): T {
    if (
      this.entry &&
      inputs.length === this.entry.inputs.length &&
      inputs.every((input, index) =>
        Object.is(input, this.entry!.inputs[index]),
      )
    )
      return this.entry.value;
    const value = build();
    this.entry = { inputs, value };
    return value;
  }
  clear(): void {
    this.entry = null;
  }
}
