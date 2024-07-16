import * as vscode from "vscode";

import { AmalgamDocumentSymbolProvider } from "./symbols";
import { AmalgamDefinitionProvider } from "./definitions";

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

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { scheme: "file", language: "amalgam" },
      new AmalgamDefinitionProvider()
    )
  )
}
