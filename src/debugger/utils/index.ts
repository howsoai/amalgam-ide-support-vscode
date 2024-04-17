import { homedir } from "os";
export * from "./execute";
export * from "./notify";

export function expandUserHome(filePath: string): string {
  if (!filePath || typeof filePath !== "string") {
    return "";
  }

  if (filePath.startsWith("~/") || filePath === "~") {
    return filePath.replace("~", homedir());
  }

  return filePath;
}
