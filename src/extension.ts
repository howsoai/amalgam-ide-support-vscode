import * as vscode from "vscode";
import { activateDebug } from "./debugger/activate";
import { activateLanguage } from "./language/activate";
import { InlineDebugAdapterFactory, ExternalDebugAdapterFactory } from "./debugger/factory";

/*
 * The compile time flag 'runMode' controls how the debug adapter is run.
 */
const runMode: "external" | "inline" = "inline";

export function activate(context: vscode.ExtensionContext) {
  // debug adapters can be run in different ways by using a vscode.DebugAdapterDescriptorFactory:
  switch (runMode) {
    case "inline":
      // Run the debug adapter inside the extension and directly talk to it
      activateDebug(context, new InlineDebugAdapterFactory());
      break;
    case "external":
      // Run the debug adapter as a separate process
      activateDebug(context, new ExternalDebugAdapterFactory());
      break;
    default:
      throw new Error(`Run mode '${runMode}' not implemented`);
  }
  // language features
  activateLanguage(context);
}

export function deactivate() {
  // nothing to do
}
