/**
 * Converts the Amalgam documentation language.js to snippets for VSCode.
 *
 * Run this script from the root of the project:
 * > node ./bin/genSnippets.js ~/my/path/to/amalgam/documentation/language.js
 */
import path from "node:path";
import fs from "node:fs";

const TARGET_FILE = path.resolve("snippets/amalgam.snippets.json");

async function convert(filePath) {
  if (filePath == null) {
    throw new Error("A filepath to the Amalgam language.js is required.");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error("The provided filepath does not exist");
  }

  const { language } = await import(filePath);
  const output = {};

  for (const item of language) {
    const { parameter, description, ...docs } = item;
    if (parameter != null) {
      let params = parameter.split(" ");
      if (params[0].startsWith("[")) continue;
      const opcode = "(" + params[0];
      params = params.slice(1).join(" ");
      output[opcode] = {
        prefix: opcode,
        body: [opcode],
        description: `${params} || ${description}`,
        // Custom property for use in HoverProvider
        $doc: docs,
      };
    }
  }

  const data = JSON.stringify(output, null, 4);
  fs.writeFileSync(TARGET_FILE, data, { flag: "w+" });
}

await convert(process.argv[2]);
