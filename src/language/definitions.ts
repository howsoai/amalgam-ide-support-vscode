import * as vscode from "vscode";
import { getDepthChange } from "./util";

export class AmalgamDefinitionProvider implements vscode.DefinitionProvider {
  private lineSkipRegex = /^\s*(?:$|[;#])/;
  private assocRegex = /^\(assoc(?:$|\s|\))/i;

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }
    let word = document.getText(wordRange);

    // Check for label scope character before the word
    if (wordRange.start.character > 0) {
      const charBeforeWord = document.getText(new vscode.Range(wordRange.start.translate(0, -1), wordRange.start));
      if (charBeforeWord === "!") {
        word = "!" + word;
      } else if (charBeforeWord === "^") {
        word = "\\^" + word;
      }
    }

    // Match the word as a bare key at the start of a line (optional indent, then word, then space or EOL)
    const definitionPattern = new RegExp(`^(\\s*)(${word})(?:\\s+|$)`);

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder.uri, "**/**.amlg"),
      undefined,
      undefined,
      token
    );

    const locations: vscode.Location[] = [];
    for (const uri of files) {
      if (token.isCancellationRequested) return undefined;

      const file = await vscode.workspace.openTextDocument(uri);
      this.findDefinitionsInFile(file, definitionPattern, token, locations);
    }

    return locations;
  }

  // Scans a file with depth tracking and records any line where the given pattern matches a root-assoc key.
  private findDefinitionsInFile(
    file: vscode.TextDocument,
    pattern: RegExp,
    token: vscode.CancellationToken,
    locations: vscode.Location[]
  ): void {
    let state: "seeking" | "in-assoc" | "none" | "done" = "seeking";
    let depth = 0;

    for (let i = 0; i < file.lineCount; i++) {
      if (token.isCancellationRequested) return;

      const text = file.lineAt(i).text;
      if (this.lineSkipRegex.test(text)) continue;

      const depthChange = getDepthChange(text);
      const nextDepth = depth + depthChange;

      if (state === "seeking") {
        const trimmed = text.trimStart();
        if (this.assocRegex.test(trimmed) || trimmed.startsWith("{")) {
          state = "in-assoc";
        } else {
          state = "none";
        }
        depth = nextDepth;
        continue;
      }

      if (state !== "in-assoc") break;

      if (depth === 1) {
        const matches = pattern.exec(text);
        if (matches) {
          locations.push(new vscode.Location(file.uri, new vscode.Position(i, matches[1].length)));
        }
      }

      depth = nextDepth;
      if (depth <= 0) break;
    }
  }
}
