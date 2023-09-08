import * as vscode from "vscode";
import { WorkspaceFolder, DebugConfiguration, ProviderResult } from "vscode";

export class AmalgamConfigurationProvider implements vscode.DebugConfigurationProvider {
  /**
   * Massage a debug configuration just before a debug session is being launched,
   * e.g. add all missing attributes to the debug configuration.
   */
  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration
  ): ProviderResult<DebugConfiguration> {
    // If launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "amalgam") {
        config.type = "amalgam";
        config.name = "Launch Amalgam";
        config.request = "launch";
        config.program = "${file}";
        config.stopOnEntry = false;
      }
    }

    if (!config.program) {
      return vscode.window.showInformationMessage("Cannot find a program to debug").then(() => {
        return undefined; // abort launch
      });
    }

    return config;
  }
}
