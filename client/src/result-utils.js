export function tryParseJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed || !["{", "["].includes(trimmed[0])) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function extractDisplayResult(payload, seen = new Set()) {
  const value = tryParseJson(payload);

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined || typeof value !== "object") {
    return value ?? "";
  }

  if (seen.has(value)) {
    return value;
  }

  seen.add(value);

  for (const key of ["data", "result", "answer", "output", "content"]) {
    if (Object.hasOwn(value, key) && value[key] != null) {
      return extractDisplayResult(value[key], seen);
    }
  }

  return value;
}

export function formatDisplayResult(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

