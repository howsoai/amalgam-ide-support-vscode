import * as vscode from "vscode";
import * as fs from "fs";

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

    // Check for exclamation point before the word
    if (wordRange.start.character > 0) {
      const charBeforeWord = document.getText(
        new vscode.Range(new vscode.Position(wordRange.start.line, wordRange.start.character - 1), wordRange.start)
      );
      if (charBeforeWord === "!") {
        word = "!" + word;
      }
    }
    const definitionPattern = new RegExp(`^[^;]*#${word}`);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return undefined;
    }

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
    for (const file of files) {
      if (token.isCancellationRequested) {
        return undefined;
      }

      const content = await this.readFile(file.fsPath);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (token.isCancellationRequested) {
          return undefined;
        }
        if (definitionPattern.test(lines[i])) {
          const definitionUri = vscode.Uri.file(file.fsPath);
          const definitionPosition = new vscode.Position(i, lines[i].indexOf(`#${word}`));
          locations.push(new vscode.Location(definitionUri, definitionPosition));
        }
      }
    }

    if (locations.length > 0){
      return locations
    }
    return undefined;
  }

  private async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, "utf-8");
  }
}
