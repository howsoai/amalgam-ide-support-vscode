import * as vscode from "vscode";

export class AmalgamDefinitionProvider implements vscode.DefinitionProvider {
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
    // Find a label definition by meeting the following criteria:
    // 1. The label word is not preceded by a semicolon, representing a comment
    // 2. The label word is only immediately preceded by a single `#`
    // 3. The label word is immediately followed by at least one whitespace or the end of the line
    // We then capture the text leading up to the matched definition and the definition word itself
    const definitionPattern = new RegExp(`^([^;]*)(?<!#)(#${word})(?:\\s+|$).*$`);

    // Get all Amalgam file URIs in the workspace
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

    // For each file check each line for matches to the definition pattern
    const locations: vscode.Location[] = [];
    for (const uri of files) {
      if (token.isCancellationRequested) {
        return undefined;
      }

      const file = await vscode.workspace.openTextDocument(uri);
      for (let i = 0; i < file.lineCount; i++) {
        if (token.isCancellationRequested) {
          return undefined;
        }
        const line = file.lineAt(i);
        const matches = definitionPattern.exec(line.text);
        if (matches) {
          const definitionPosition = new vscode.Position(i, matches[1].length);
          locations.push(new vscode.Location(file.uri, definitionPosition));
        }
      }
    }

    return locations;
  }
}
