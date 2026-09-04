const DANGEROUS_FORMAT_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

export function sanitizeTerminalText(value: string): string {
  return value.replace(DANGEROUS_FORMAT_CHARACTER_PATTERN, (character) => {
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    const codePoint = character.codePointAt(0);
    return codePoint === undefined
      ? "\\u{UNKNOWN}"
      : `\\u{${codePoint.toString(16).toUpperCase()}}`;
  });
}
