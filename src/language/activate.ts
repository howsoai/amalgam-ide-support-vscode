import * as vscode from "vscode";
import { AmalgamDocumentSymbolProvider } from "./symbols";

/**
 * Activate language features.
 * @param context The VS Code extension context.
 */
export function activateLanguage(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { scheme: "file", language: "amalgam" },
      new AmalgamDocumentSymbolProvider()
    )
  );
}
