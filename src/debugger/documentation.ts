import * as vscode from "vscode";
import { TextDecoder } from "node:util";

export type OpcodeDefinition = {
  parameters: string;
  description: string;
  output: string;
  example: string;
  concurrency: boolean;
};

export type OpcodeIndex = Record<string, OpcodeDefinition>;

/**
 * Load opcode documentation from the bundled extension files.
 * @param context The vscode extension context.
 * @returns The opcode documentation.
 */
export async function loadOpcodeDocumentation(context: vscode.ExtensionContext): Promise<OpcodeIndex> {
  const filepath = vscode.Uri.joinPath(context.extensionUri, "snippets", "amalgam.snippets.json");
  const data = await vscode.workspace.fs.readFile(filepath);
  const decoder = new TextDecoder("utf-8");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const document: Record<string, any> = JSON.parse(decoder.decode(data));
    return Object.entries(document).reduce((map, [key, value]) => {
      if (value.description) {
        const [parameters, description] = value.description.split(" || ", 2);
        map[key] = {
          ...value.$doc,
          parameters,
          description,
        };
      }
      return map;
    }, {});
  } catch (reason) {
    console.warn("Failed to read Amalgam snippets");
  }
  return {};
}
