/**
 * Finds the first complete, balanced `{...}` object in free-form text and
 * parses it. Needed because the model is instructed to lead with a JSON
 * object but may (against instructions) still add a trailing note — a bare
 * `JSON.parse(text)` would fail on that trailing text even when the JSON
 * itself is well-formed. Brace-counting has to track string literals,
 * otherwise a `}` inside a quoted contributing_factors phrase would end the
 * scan early.
 */
export function extractFirstJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
