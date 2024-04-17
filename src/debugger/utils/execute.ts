import { exec } from "child_process";

/**
 * Call Amalgam binary to run a one off command.
 * @param executable The path to the Amalgam executable.
 * @param args The command line arguments.
 * @returns The stdout result.
 */
export const executeCommand = (executable: string, args: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec(`"${executable}" ${args}`, (error, stdout, stderr) => {
      if (error) {
        reject(`error: ${error.message}`);
        return;
      }
      if (stderr) {
        reject(`stderr: ${stderr}`);
        return;
      }
      resolve(stdout);
    });
  });
};
