/**
 * Converts the Amalgam documentation to snippets for VSCode.
 *
 * Run this script from the root of the project:
 * > node ./bin/genSnippets.js ~/my/path/to/amalgam
 */
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET_FILE = path.resolve(import.meta.dirname + "/../snippets/amalgam.snippets.json");

async function convert(amalgamPath) {
  if (amalgamPath == null) {
    throw new Error("A filepath to the Amalgam executable is required.");
  }
  if (!fs.existsSync(amalgamPath)) {
    throw new Error("The provided Amalgam filepath does not exist");
  }

  // Run amalgam binary on the help.amlg file to capture all opcode documentation
  const result = spawnSync(amalgamPath, ["help.amlg"], {
    encoding: "utf-8",
    cwd: import.meta.dirname,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error(`Exited with code ${result.status}`);
  }

  // Parse the result and update snippets
  const help = JSON.parse(result.stdout);
  const output = {};

  for (const item of help) {
    const { opcode, parameters, description, ...docs } = item;
    if (opcode != null) {
      // TODO: continue if not (opcode)
      // if (params[0].startsWith("[")) continue;
      const opcode_key = "(" + opcode;
      output[opcode_key] = {
        prefix: opcode_key,
        body: [opcode_key],
        description: `${parameters} || ${description}`,
        // Custom property for use in HoverProvider
        $doc: docs,
      };
    }
  }

  const data = JSON.stringify(output, null, 4);
  fs.writeFileSync(TARGET_FILE, data, { flag: "w+" });
}

await convert(process.argv[2]);
