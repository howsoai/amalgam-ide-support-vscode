/**
 * Calculate the net s-expression depth change.
 * @param text The text to parse.
 * @returns The depth change number.
 */
export function getDepthChange(text: string): number {
  let change = 0;
  let inString = false;
  let stringChar = "";

  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (inString) {
      if (ch === "\\") {
        j++;
      } else if (ch === stringChar) {
        inString = false;
      }
    } else {
      if (ch === ";" || ch === "#") break; // comment or annotation
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
      } else if (ch === "(" || ch === "{" || ch === "[") {
        change++;
      } else if (ch === ")" || ch === "}" || ch === "]") {
        change--;
      }
    }
  }

  return change;
}
