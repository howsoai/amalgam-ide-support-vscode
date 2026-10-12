/**
 * Converts the Amalgam documentation to snippets for VSCode.
 *
 * Run this script from the root of the project:
 * > node ./bin/genSnippets.js ~/my/path/to/amalgam-binary
 */
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET_FILE = path.resolve(import.meta.dirname + "/../snippets/amalgam.snippets.json");
const TMLANGUAGE_FILE = path.resolve(import.meta.dirname + "/../syntaxes/amalgam.tmLanguage.json");
const LITERALS = ["string", "number", "bool", "symbol", "null"];

function getDefinedOpcodes() {
  // Get opcodes defined in the tmLanguage file
  const grammar = JSON.parse(fs.readFileSync(TMLANGUAGE_FILE, "utf-8"));
  const opcodesDef = grammar.repository?.opcodes?.match;
  const loopVarsDef = grammar.repository?.["loop-vars"]?.match;
  if (!opcodesDef) throw new Error("Could not find repository > opcodes > match in amalgam.tmLanguage.json");
  if (!loopVarsDef) throw new Error("Could not find repository > loop-vars > match in amalgam.tmLanguage.json");

  // Extract opcodes from match string
  const opcodesMatch = opcodesDef.match(/^\(\?<=\\+\(\)\((.+)\)\(\?=\[\\s\)\]\)$/);
  if (!opcodesMatch) throw new Error("Could not parse opcodes from tmLanguage regex.");
  // Extract loop-var opcodes from match string
  const loopVarMatch = loopVarsDef.match(/^\(\(\?<=\\+\(\)(.+)\)$/);
  if (!loopVarMatch) throw new Error("Could not parse loop-vars from tmLanguage regex.");

  const loopVarOpcodes = new Set(
    loopVarMatch[1]
      .split("|")
      .map((t) => t.replace(/\\/g, "").trim())
      .filter((t) => t.length)
  );

  const opcodes = new Set([
    ...opcodesMatch[1]
      .split("|")
      .map((t) => t.replace(/\\/g, "").trim())
      .filter((t) => t.length),
    ...loopVarOpcodes,
  ]);

  return opcodes;
}

function validateOpcodes(help) {
  const opcodes = getDefinedOpcodes();

  // Classify help opcodes by argument signature
  const relevant = help.filter((op) => op.opcode != null && !LITERALS.includes(op.opcode));
  const helpOpcodes = new Set(help.map((item) => item.opcode).filter(Boolean));

  // All relevant opcodes must be in opcodes
  const missingFromOpcodes = relevant.map((op) => op.opcode).filter((op) => !opcodes.has(op));
  if (missingFromOpcodes.length > 0) {
    console.warn("WARNING: The following opcodes are missing from the tmLanguage opcodes regex:");
    for (const opcode of missingFromOpcodes) console.warn(`  - ${opcode}`);
  }

  // Reverse: opcodes in tmLanguage must exist in help documentation
  const extraOpcodes = [...opcodes].filter((op) => !helpOpcodes.has(op));
  if (extraOpcodes.length > 0) {
    console.warn("WARNING: The following tmLanguage opcodes have no associated help documentation:");
    for (const opcode of extraOpcodes) console.warn(`  - ${opcode}`);
  }
}

/** Convert Amalgam help documentation into snippets. */
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
  validateOpcodes(help);

  const output = {};

  for (const item of help) {
    const { opcode, parameters, description, ...docs } = item;
    if (opcode != null && !LITERALS.includes(opcode)) {
      const opcode_prefix = "(" + opcode;
      output[opcode] = {
        prefix: opcode_prefix,
        body: [opcode_prefix],
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
