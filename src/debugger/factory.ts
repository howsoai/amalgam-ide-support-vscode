import * as vscode from "vscode";
import { AmalgamDebugSession } from "./session";

/**
 * Debug adapter factory for directly talking to Amalgam debugger.
 */
export class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new AmalgamDebugSession(session));
  }
}

/**
 * Debug adapter factory for external adapter executable.
 * TODO: Debug Adapter Protocol not yet implemented in Amalgam
 */
export class ExternalDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    // If the executable specified in the package.json does not exist, use the system default
    if (!executable) {
      const command = "~/.amalgam/bin/amalgam";
      const args = ["--debug", "--debug-sources"];
      const options = {
        cwd: session.workspaceFolder?.uri?.toString(), // working directory for executable
        // env: { envVariable: "some value" },
      };
      executable = new vscode.DebugAdapterExecutable(command, args, options);
    }

    // Make VSCode launch the DA executable
    return executable;
  }
}
