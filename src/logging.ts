import * as vscode from "vscode";

export type SourceName = "stdin" | "stdout" | "stderr" | "info" | "warn" | "debug" | "error" | "cpinfo" | "";

export class Logger {
  private sourceLength = 8;

  constructor(public outputLine: (txt: string) => void) {}

  private logLine(source: SourceName, text: string): void {
    if (!text) {
      return;
    }
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines.length && lines[lines.length - 1] === "") {
      // Remove final blank line
      lines.pop();
    }
    const ts = getTimeStamp();
    const src = source.padEnd(this.sourceLength, " ");

    for (const line of lines) {
      this.outputLine(`${ts} [${src}] ${line}`);
    }
  }

  public logText(source: SourceName, ...txt: string[]): void {
    txt.map((t) => this.logLine(source, t));
  }

  public log(source: SourceName, ...msg: unknown[]): void {
    const text = msg.map((m) => forceString(m));
    this.logLine(source, text.join(" "));
  }

  public info(...msg: unknown[]): void {
    this.log("info", ...msg);
  }

  public warn(...msg: unknown[]): void {
    this.log("warn", ...msg);
  }

  public debug(...msg: unknown[]): void {
    this.log("debug", ...msg);
  }

  public error(...msg: unknown[]): void {
    this.log("error", ...msg);
  }
}

function makeVsCodeLogger(): Logger {
  const outputChannel = vscode.window.createOutputChannel("Amalgam Runtime");
  const logger = new Logger((text: string) => outputChannel.appendLine(text));
  return logger;
}

function getTimeStamp(): string {
  const date = new Date();
  const s = date.toISOString().replace(/^.*T(.*)Z$/, "$1");
  return s;
}

function forceString(x: unknown): string {
  if (typeof x === "string") {
    return x;
  } else if (x instanceof Buffer) {
    return String(x);
  } else if (typeof x === "object") {
    return JSON.stringify(x);
  } else {
    return String(x);
  }
}

export const logger = makeVsCodeLogger();
