import * as vscode from "vscode";
import { WorkspaceFolder, DebugConfiguration, ProviderResult } from "vscode";
import { AmalgamConfigurationProvider } from "./configuration";

/**
 * Activate debugger.
 * @param context The VS Code extension context.
 * @param factory The debug adapter factory.
 */
export function activateDebug(context: vscode.ExtensionContext, factory: vscode.DebugAdapterDescriptorFactory) {
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.amalgam.runEditorContents", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(
          undefined,
          {
            type: "amalgam",
            name: "Run File",
            request: "launch",
            program: targetResource.fsPath,
          },
          { noDebug: true }
        );
      }
    }),
    vscode.commands.registerCommand("extension.amalgam.debugEditorContents", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(undefined, {
          type: "amalgam",
          name: "Debug Amalgam",
          request: "launch",
          program: targetResource.fsPath,
          stopOnEntry: false,
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("extension.amalgam.chooseAmalgamFile", () => {
      return vscode.window.showInputBox({
        placeHolder: "Please enter the name of an Amalgam file in the workspace folder",
        value: "myfile.amlg",
      });
    })
  );

  // register a configuration provider for 'amalgam' debug type
  const provider = new AmalgamConfigurationProvider();
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("amalgam", provider));

  // register a dynamic configuration provider for 'amalgam' debug type
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "amalgam",
      {
        provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
          return [
            {
              name: "Dynamic Launch",
              request: "launch",
              type: "amalgam",
              program: "${file}",
              workingDirectory: folder,
            },
            {
              name: "Another Dynamic Launch",
              request: "launch",
              type: "amalgam",
              program: "${file}",
              workingDirectory: folder,
            },
            {
              name: "Amalgam Launch",
              request: "launch",
              type: "amalgam",
              program: "${file}",
              workingDirectory: folder,
            },
          ];
        },
      },
      vscode.DebugConfigurationProviderTriggerKind.Dynamic
    )
  );

  // Override default implementation of the debug hover, here we attempt to only match words that may be
  // a variable name
  context.subscriptions.push(
    vscode.languages.registerEvaluatableExpressionProvider("amalgam", {
      provideEvaluatableExpression(
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.ProviderResult<vscode.EvaluatableExpression> {
        const VARIABLE_REGEXP = /(?<![(#"'a-z0-9_.])(?<name>[_a-z]+[_a-z0-9]*)(?!["'a-z0-9])/gi;
        const line = document.lineAt(position.line).text;

        let matches: RegExpExecArray | null;
        top: while ((matches = VARIABLE_REGEXP.exec(line)) != null) {
          if (matches.groups) {
            const name = matches.groups.name;
            const varRange = new vscode.Range(position.line, matches.index, position.line, matches.index + name.length);

            // Don't match when inside a string
            const QUOTE_REGEXP = /(["'])(?:(?=(\\?))\2.)*?\1/g;
            let qMatches: RegExpExecArray | null;
            while ((qMatches = QUOTE_REGEXP.exec(line)) != null) {
              const qRange = new vscode.Range(
                position.line,
                qMatches.index,
                position.line,
                qMatches.index + qMatches[0].length
              );
              if (qRange.contains(varRange)) {
                continue top;
              }
            }

            // Don't match when inside a comment
            const COMMENT_REGEXP = /;.*$/g;
            let cMatches: RegExpExecArray | null;
            while ((cMatches = COMMENT_REGEXP.exec(line)) != null) {
              const cRange = new vscode.Range(
                position.line,
                cMatches.index,
                position.line,
                cMatches.index + cMatches[0].length
              );
              if (cRange.contains(varRange)) {
                continue top;
              }
            }

            // Only match if variable in position
            if (varRange.contains(position)) {
              return new vscode.EvaluatableExpression(varRange);
            }
          }
        }
        return undefined;
      },
    })
  );

  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("amalgam", factory));
}
