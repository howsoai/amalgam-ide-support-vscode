import * as vscode from "vscode";

export class AmalgamDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  public provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
    return new Promise((resolve, reject) => {
      const symbols: vscode.DocumentSymbol[] = [];
      let symbol: vscode.DocumentSymbol | null = null;
      let prevSymbol: vscode.DocumentSymbol | null = null;

      const updatePrevSymbol = (line: number) => {
        if (prevSymbol != null) {
          // Capture previous symbol's range to be up to this symbol's start
          prevSymbol.range = new vscode.Range(prevSymbol.range.start, new vscode.Position(line, 0));
          prevSymbol = null;
        }
      };

      for (let i = 0; i < document.lineCount; i++) {
        if (token.isCancellationRequested) {
          reject("cancelled");
          return;
        }

        const line = document.lineAt(i);
        if (symbol) {
          // Look ahead to see if label's nested value is a variable
          if (/^\s*(?:;.*)?$/.test(line.text)) {
            // Blank or comment line
            continue;
          }

          const reg = /^\s*(.+)\s*.*$/;
          const matches = reg.exec(line.text);
          if (matches) {
            symbol.kind = this.checkType(matches[1], vscode.SymbolKind.Function);
          }

          updatePrevSymbol(i);
          prevSymbol = symbol;
          symbols.push(symbol);
          symbol = null; // reset to look for next label
        } else {
          // Match label
          // 1: Leading text up to and including #
          // 2: The opcode
          // 3: Tailing text to end of line
          const reg = /^(\s*#)[\^!]?(\w+)\s*(.*)?\s*$/;
          const matches = reg.exec(line.text);

          if (matches) {
            const symbolRange = new vscode.Range(i, matches[1].length, i, line.range.end.character);
            const selectionRange = new vscode.Range(i, matches[1].length, i, matches[1].length + matches[2].length);
            symbol = new vscode.DocumentSymbol(matches[2], "", vscode.SymbolKind.Function, symbolRange, selectionRange);

            // Treat as variable when value is on same line
            if (matches[3]) {
              updatePrevSymbol(i);
              symbol.kind = this.checkType(matches[3], vscode.SymbolKind.Variable);
              symbols.push(symbol);
              symbol = null; // reset to look for next label
            }
          }
        }
      }
      updatePrevSymbol(document.lineCount);
      resolve(symbols);
    });
  }

  private checkType(text: string, defaultKind: vscode.SymbolKind) {
    if (/^(?:["'](?:[^"\\]|\\.)*["']|\.nas)(?:\s*;.*)?$/.test(text)) {
      return vscode.SymbolKind.String;
    } else if (/^(?:\d+\.?\d*|\.nan|-?\.infinity)(?:\s*;.*)?$/.test(text)) {
      return vscode.SymbolKind.Number;
    } else if (/^\((?:true|false)\)(?:\s*;.*)?$/i.test(text)) {
      return vscode.SymbolKind.Boolean;
    } else if (/^\(list(?:\s.*)?$/i.test(text)) {
      return vscode.SymbolKind.Array;
    } else if (/^\(assoc(?:\s.*)?$/i.test(text)) {
      return vscode.SymbolKind.Object;
    } else if (/^\(null\)(?:\s*;.*)?$/i.test(text)) {
      return vscode.SymbolKind.Variable;
    }
    return defaultKind;
  }
}
