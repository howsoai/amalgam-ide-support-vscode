import { homedir } from "os";
export * from "./execute";
export * from "./notify";

/**
 * Expand user home in filepath to absolute filepath.
 * @param filePath The filepath to expand.
 * @returns The expanded filepath.
 */
export function expandUserHome(filePath: string): string {
  if (!filePath || typeof filePath !== "string") {
    return "";
  }

  if (filePath.startsWith("~/") || filePath === "~") {
    return filePath.replace("~", homedir());
  }

  return filePath;
}

/**
 * Collapse newlines and excess whitespace from value.
 * @param value The value to collapse.
 * @returns The modified value.
 */
export function collapseWhitespace(value: string): string {
  return value.split("\n").reduce((accumulator, line) => {
    const trimmedLine = line.trim();
    if (trimmedLine) {
      if (accumulator) accumulator += " ";
      accumulator += trimmedLine;
    }
    return accumulator;
  }, "");
}

/**
 * Prepare an expression before evaluation.
 * @param expression The expression to prepare.
 * @returns The modified expression.
 */
export function prepareExpression(expression: string): string {
  return expression.split("\n").reduce((accumulator, line) => {
    let trimmedLine = line.trim();
    const commentIndex = trimmedLine.indexOf(";");
    if (commentIndex != -1) {
      // Remove comments
      trimmedLine = trimmedLine.substring(0, commentIndex);
    }
    if (trimmedLine) {
      if (accumulator) accumulator += " ";
      accumulator += trimmedLine;
    }
    return accumulator;
  }, "");
}
