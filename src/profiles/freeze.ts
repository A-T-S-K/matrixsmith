export function freezeDefinition<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDefinition(child);
    Object.freeze(value);
  }
  return value;
}
