export function encode(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, encode(v)]));
  }
  return value;
}

export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    if ("$date" in value && typeof value.$date === "string") return new Date(value.$date);
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, decode(v)]));
  }
  return value;
}
