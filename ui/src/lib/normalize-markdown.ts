/**
 * Normalize pasted markdown by removing common leading whitespace (dedent)
 * and normalizing line endings. This fixes formatting issues when pasting
 * content from terminals/consoles that add uniform indentation.
 */
export function normalizeMarkdown(text: string): string {
  // Normalize line endings
  let result = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = result.split("\n");
  if (lines.length <= 1) return result;

  // Find minimum indentation across non-empty lines
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const match = line.match(/^(\s+)/);
    if (match) {
      minIndent = Math.min(minIndent, match[1].length);
    } else {
      minIndent = 0;
      break;
    }
  }

  // Strip common indent and trim whitespace-only lines
  if (minIndent > 0 && minIndent < Infinity) {
    result = lines
      .map((line) => {
        if (line.trim() === "") return "";
        return line.slice(minIndent);
      })
      .join("\n");
  }

  return result;
}
