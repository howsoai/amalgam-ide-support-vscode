import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

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
    const definitionPattern = new RegExp(`#${word}`);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return undefined;
    }


    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }
    const files = await this.getAllAmlgFiles(workspaceFolder.uri.fsPath);

    for (const file of files) {
      if (token.isCancellationRequested) {
        return undefined;
      }

      const content = await this.readFile(file);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (definitionPattern.test(lines[i])) {
          const definitionUri = vscode.Uri.file(file);
          const definitionPosition = new vscode.Position(i, lines[i].indexOf(`#${word}`));
          return new vscode.Location(definitionUri, definitionPosition);
        }
      }
    }

    return undefined;
  }

  private async getAllAmlgFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.getAllAmlgFiles(fullPath)));
      } else if (entry.isFile() && path.extname(entry.name) === ".amlg") {
        files.push(fullPath);
      }
    }

    return files;
  }

  private async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, "utf-8");
  }
}
