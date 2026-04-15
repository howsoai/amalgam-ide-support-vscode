import * as vscode from "vscode";
import { getDepthChange } from "./util";

export class AmalgamDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  public provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    return new Promise((resolve, reject) => {
      const symbols: vscode.DocumentSymbol[] = [];

      // Labels only exist when the file root is (assoc ...) or {...}
      let state: "seeking" | "in-assoc" | "none" | "done" = "seeking";
      let depth = 0; // paren/brace nesting depth; 1 = directly inside root assoc
      let expectingKey = true; // keys and values strictly alternate at depth 1
      let lastContentLine = 0; // last non-blank/comment/annotation line processed

      let pendingSymbol: vscode.DocumentSymbol | null = null;
      let prevSymbol: vscode.DocumentSymbol | null = null;
      const skipLineRegex = /^\s*(?:$|[;#])/;
      const assocRegex = /^\(assoc(?:$|\s|\))/i;

      // End the previous symbol's range just after the last content line.
      // Called when a new key is found, so blank/comment lines sitting above
      // the new key are not absorbed into the previous symbol's range.
      const finalizePrevSymbol = () => {
        if (prevSymbol) {
          const endChar = document.lineAt(lastContentLine).range.end.character;
          // This will update the symbol in the list, then we can clear the reference
          prevSymbol.range = new vscode.Range(prevSymbol.range.start, new vscode.Position(lastContentLine, endChar));
          prevSymbol = null;
        }
      };

      for (let i = 0; i < document.lineCount; i++) {
        if (token.isCancellationRequested) {
          reject("cancelled");
          return;
        }

        const lineObj = document.lineAt(i);
        const text = lineObj.text;

        // Skip blank, comment (;...), and annotation (#...) lines without updating lastContentLine
        if (skipLineRegex.test(text)) {
          continue;
        }

        const depthChange = getDepthChange(text);
        const nextDepth = depth + depthChange;

        if (state === "seeking") {
          // First significant line determines whether this file has labels
          const trimmed = text.trimStart();
          if (assocRegex.test(trimmed) || trimmed.startsWith("{")) {
            state = "in-assoc";
          } else {
            state = "none";
          }
          depth = nextDepth;
          lastContentLine = i;
          continue;
        }

        if (state !== "in-assoc") break;

        if (depth === 1) {
          if (expectingKey) {
            // Finalize previous symbol before processing the new key.
            // lastContentLine still points to the previous value's last line,
            // so blank/comment lines above the new key are excluded.
            finalizePrevSymbol();

            const labelReg = /^(\s*)([!^]?\w+)(.*)?$/;
            const matches = labelReg.exec(text);
            if (matches) {
              const indent = matches[1].length;
              const name = matches[2];
              const rest = (matches[3] ?? "").trim();

              const symbolRange = new vscode.Range(i, indent, i, lineObj.range.end.character);
              const selectionRange = new vscode.Range(i, indent, i, indent + name.length);
              const sym = new vscode.DocumentSymbol(name, "", vscode.SymbolKind.Function, symbolRange, selectionRange);

              if (rest && !rest.startsWith(";") && !rest.startsWith("#")) {
                // Value on the same line as the key
                sym.kind = this.checkType(rest, vscode.SymbolKind.Variable);
                symbols.push(sym);
                prevSymbol = sym;
                expectingKey = true;
              } else {
                // Value is on a subsequent line
                pendingSymbol = sym;
                expectingKey = false;
              }
            }
          } else {
            // This line begins the value for pendingSymbol
            if (pendingSymbol) {
              pendingSymbol.kind = this.checkType(text.trimStart(), vscode.SymbolKind.Function);
              symbols.push(pendingSymbol);
              prevSymbol = pendingSymbol;
              pendingSymbol = null;
            }
            // Simple value (no depth change) means the next line is a key
            if (depthChange === 0) {
              expectingKey = true;
            }
            // If depthChange > 0 the value spans multiple lines; wait for depth to return to 1
          }
        }

        // Returning to depth 1 from a nested block means we finished a multi-line value
        if (depth > 1 && nextDepth === 1) {
          expectingKey = true;
        }

        depth = nextDepth;
        lastContentLine = i; // update after finalizePrevSymbol so it reflects the previous symbol's last line
        if (depth <= 0) {
          state = "done";
          break;
        }
      }

      finalizePrevSymbol();
      resolve(symbols);
    });
  }

  private checkType(text: string, defaultKind: vscode.SymbolKind) {
    if (/^(?:["'](?:[^"\\]|\\.)*["'])(?:\s*;.*)?$/.test(text)) {
      return vscode.SymbolKind.String;
    } else if (/^(?:\d+\.?\d*|-?\.infinity)(?:\s*;.*)?$/.test(text)) {
      return vscode.SymbolKind.Number;
    } else if (/^\.(?:true|false)(?:\s*;.*)?$/i.test(text)) {
      return vscode.SymbolKind.Boolean;
    } else if (/^\.null(?:\s*;.*)?$/i.test(text)) {
      return vscode.SymbolKind.Null;
    } else if (/^\((?:list|unordered_list)(?:\s.*)?$/i.test(text)) {
      return vscode.SymbolKind.Array;
    } else if (/^\[.*/i.test(text)) {
      return vscode.SymbolKind.Array;
    } else if (/^\(assoc(?:\s.*)?$/i.test(text)) {
      return vscode.SymbolKind.Object;
    } else if (/^{.*/i.test(text)) {
      return vscode.SymbolKind.Object;
    }
    return defaultKind;
  }
}
