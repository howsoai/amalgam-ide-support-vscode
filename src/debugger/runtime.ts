import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter } from "events";
import { platform } from "os";
import { queue, QueueObject } from "async";
import { logger } from "../logging";
import { InvalidRuntimeResponse, RuntimeCommandCancelled, RuntimeNotStarted } from "./errors";
import { NotifySubject, collapseWhitespace, prepareExpression } from "./utils";

export type DataSource = "stdout" | "stderr" | "stdin";

export type RuntimePostfix = "-st" | "-mt" | "-mt-noavx" | "-omp" | "";

/** Runtime launch options */
export interface IRuntimeLaunchOptions {
  program: string;
  executable: string;
  args?: string[];
  cwd?: string;
  env?: {
    [key: string]: string;
  };
}

/** Types of runtime events emitted */
export enum RuntimeEvent {
  STOP_ON_ENTRY = "stopOnEntry",
  STOP_ON_STEP = "stopOnStep",
  STOP_ON_BREAKPOINT = "stopOnBreakpoint",
  STOP_ON_EXCEPTION = "stopOnException",
  BREAKPOINT_VALIDATED = "breakpointValidated",
  OUTPUT = "output",
  CONTINUE = "continue",
  END = "end",
}

/** Types of runtime stacks */
export enum RuntimeStackType {
  CALL = "Call", // The amalgam "call" stack
  CONSTRUCTION = "Construction", // The construction stack
  INTERPRET_NODE = "Interpret node", // Standard debugger call stack Amalgam<54.3.8
  OPCODE = "Opcode" // Standard debugger call stack Amalgam>=54.3.8
}

/** The types of breakpoints */
export enum RuntimeBreakpointType {
  LINE = "Line", // Breakpoints on line/columns
  OPCODES = "Opcodes", // Breakpoints on opcodes
  LABEL = "Label", // Breakpoints on labels
}

/** Runtime breakpoint toggle responses */
export type IRuntimeBreakpointAction = "added" | "removed" | null;

/** Base interface for runtime breakpoints */
export interface IRuntimeInternalBreakpoint {
  line: number;
  column: number;
  path: string;
}

/** Representation of a standard runtime breakpoint */
export interface IRuntimeBreakpoint extends IRuntimeInternalBreakpoint {
  id: number;
  verified: boolean;
}

/** Representation of a single runtime stack frame */
export interface IRuntimeStackFrame {
  index: number;
  name: string;
  file: string;
  line: number;
  column: number;
  instruction?: number;
}

/** The runtime stack response */
export interface IRuntimeStack {
  count: number;
  frames: IRuntimeStackFrame[];
}

/** Supported runtime commands */
export type IRuntimeCommand =
  | "p"
  | "c"
  | "f"
  | "fc"
  | "s"
  | "n"
  | "br"
  | "bn"
  | "pv"
  | "pp"
  | "vars"
  | "eval"
  | "stack"
  | "labels"
  | "entity"
  | "entities"
  | "threads"
  | "finish"
  | "quit";

/** A runtime queued command task */
export interface IRuntimeTask {
  command: IRuntimeCommand;
  args: unknown[];
  signal?: AbortSignal;
}

/** The result of a runtime command */
export type IRuntimeResult<T extends IRuntimeCommand = IRuntimeCommand> = T extends "stack"
  ? { type: "stack"; stack: IRuntimeStack | undefined }
  : T extends "eval" | "pv" | "pp" | "p" | "entity"
  ? { type: "eval" | "pv" | "pp" | "p" | "entity"; value: string | undefined }
  : T extends "vars" | "labels" | "entities"
  ? { type: "vars" | "labels" | "entities"; values: string[] }
  : T extends "bn"
  ? { type: "bn"; action: IRuntimeBreakpointAction }
  : T extends "br"
  ? { type: "br"; breakpoints: IRuntimeInternalBreakpoint[] }
  : T extends "threads"
  ? { type: "threads"; threads: string[] }
  : { type: IRuntimeCommand };

export type IRuntimeVariableType = string | RuntimeVariable[] | undefined;
export type IRuntimeVariableCategory = "var" | "label" | "entity";

export class RuntimeVariable {
  public reference?: number;
  public readonly category: IRuntimeVariableCategory = "var";

  public get value() {
    return this._value;
  }

  public set value(value: IRuntimeVariableType) {
    this._lazy = false;
    this._value = value;
  }

  public get lazy() {
    return this._lazy;
  }

  constructor(public readonly name: string, private _value: IRuntimeVariableType, private _lazy = false) {}
}

export class RuntimeLabel extends RuntimeVariable {
  public readonly category: IRuntimeVariableCategory = "label";
}

export class RuntimeEntity extends RuntimeVariable {
  public readonly category: IRuntimeVariableCategory = "entity";
}

export class AmalgamRuntime extends EventEmitter {
  public static readonly DEFAULT_EXECUTABLE_DIR = "~/.amalgam/bin/";
  // Default thread id when running in ST mode
  public static readonly DEFAULT_THREAD_ID = 1;

  private cp: ChildProcessWithoutNullStreams | null = null;
  private ignoreOutput = false;
  private outputBuffer = "";
  private debugStarted = new NotifySubject<null>();

  private commandQueue: QueueObject<IRuntimeTask>;
  private commandDone = new NotifySubject<IRuntimeResult>();
  private activeCommand?: IRuntimeCommand;

  // Maps from source to array of IRuntimeBreakpoint
  private breakpoints = new Map<string, IRuntimeBreakpoint[]>();

  // Each breakpoint will be assigned an id, this must be incremented on each use
  private breakpointId = 1;

  // Track current thread
  private _currentThread = AmalgamRuntime.DEFAULT_THREAD_ID;

  // Parsers for Amalgam process output
  private matchers = {
    end: /\r\r(?:(?<thread>[xa-fA-F0-9]+) )?>$/m,
    stackFrameComment: /^ {2}comment:src: (?<line>\d+) (?<column>\d+) (?<file>.+)$/gm,
    stackFrameOpcode: /^ {2}opcode: (?<opcode>.+?)(?: ?;src: (?<line>\d+) (?<column>\d+) (?<file>.+))?$/gm,
    breakpointAction: /^(?<action>Added|Removed) breakpoint for (?:.+)?$/gm,
    breakpointLine: /^ {2}(?<line>\d+)(?: (?<file>.+))?$/gm,
    // Breakpoints and stack are matched via the header line and existing subsequent nested lines
    breakpoints: /^(?<type>Line) Breakpoints:\n(?<brs>^(?:\s{2}.+)+)$/gm,
    stack: /^(?<type>Interpret node|Opcode) stack:\n(?<frames>^(?:\s{2}.+)+)$/gm,
    // Expression results match all lines up to final empty line
    expression: /^(?<value>[\s\S]+)\n{2}$/gm,
    // Results match all lines starting with 2 spaces
    lines: /^ {2}(?<line>.+)$/gm,
  };

  /** If Amalgam debugger is running */
  public get isRunning(): boolean {
    return this.cp?.pid !== undefined;
  }

  public get currentThread(): number {
    return this._currentThread;
  }

  public constructor() {
    super();
    // Initialize the command message queue
    this.commandQueue = queue<IRuntimeTask, IRuntimeResult, Error>(async (task) => {
      if (this.cp?.pid === undefined) {
        throw new RuntimeNotStarted();
      } else {
        // Write out command and wait for response
        if (task.signal?.aborted) {
          throw new RuntimeCommandCancelled();
        } else {
          try {
            this.activeCommand = task.command;
            const command = [task.command, ...task.args].join(" ");
            logger.log("stdin", command);
            this.cp.stdin?.write(command + "\n");
            return await this.commandDone.wait();
          } finally {
            this.activeCommand = undefined;
          }
        }
      }
    }, 1);
    this.commandQueue.pause();
  }

  public static getExecutableName(postfix: RuntimePostfix = "-st"): string {
    let name: string;
    switch (platform()) {
      case "win32":
        name = `amalgam${postfix}.exe`;
        break;
      default:
        name = `amalgam${postfix}`;
        break;
    }
    return name;
  }

  /**
   * Start the runtime for debugging.
   * @param launchOpts Amalgam launch options.
   * @param stopOnEntry If debugger should stop on first opcode.
   * @param debug If debug is enabled.
   * @returns True if successfully started.
   */
  public async start(launchOpts: IRuntimeLaunchOptions, stopOnEntry: boolean, debug: boolean): Promise<boolean> {
    this.ignoreOutput = false;

    try {
      this.cp = this.spawnAmalgam(launchOpts, debug);
    } catch (error) {
      logger.error(error);
      return false;
    }

    if (!this.isRunning) {
      return false;
    }

    let debugStarted: Promise<null> | undefined = undefined;
    if (debug) {
      debugStarted = this.debugStarted.wait();
    }

    // Handle output from Amalgam process
    this.cp.stdout.on("data", (data) => {
      this.handleOutput("stdout", data);
    });
    this.cp.stderr.on("data", (data) => {
      this.handleOutput("stderr", data);
    });

    if (debug) {
      if (debugStarted != null) {
        await debugStarted;
      }
      await this.verifyBreakpoints();
      if (stopOnEntry) {
        this.sendEvent(RuntimeEvent.STOP_ON_ENTRY, this.currentThread);
      } else {
        this.continue();
      }
    }

    return true;
  }

  /**
   * Terminate the runtime.
   */
  public terminate(): void {
    this.commandQueue.kill();
    this.commandDone.cancel();
    if (this.cp?.pid) {
      if (platform() === "win32") {
        // Need to explicitly call taskkill on Windows so the process is stopped including any child
        // processes it spawned
        spawn("taskkill", ["/pid", this.cp.pid.toString(), "/f", "/t"]);
      } else {
        this.cp.kill("SIGKILL");
      }
    }

    this.cp = null;
  }

  /**
   * Quit running the program. Closing process gracefully.
   * NOTE: Will continue running until next stopping point.
   */
  public async quit(): Promise<void> {
    await this.sendCommand("quit");
  }

  /**
   * Finish running the program, leaving debug mode.
   */
  public async finish(): Promise<void> {
    this.sendEvent(RuntimeEvent.CONTINUE, this.currentThread);
    await this.sendCommand("finish");
  }

  /**
   * Continue to next breakpoint.
   */
  public async continue(): Promise<void> {
    this.sendEvent(RuntimeEvent.CONTINUE, this.currentThread);
    await this.sendCommand("c");
    this.sendEvent(RuntimeEvent.STOP_ON_BREAKPOINT, this.currentThread);
  }

  /**
   * Step through code, runs to next opcode.
   * @param instruction If step granularity is for instructions.
   */
  public async step(instruction: boolean): Promise<void> {
    this.sendEvent(RuntimeEvent.CONTINUE, this.currentThread);
    if (instruction) {
      logger.warn("Step 'instruction' not yet implemented");
      await this.sendCommand("n");
    } else {
      await this.sendCommand("n");
    }
    this.sendEvent(RuntimeEvent.STOP_ON_STEP, this.currentThread);
  }

  /**
   * Step into next opcode.
   */
  public async stepIn(): Promise<void> {
    this.sendEvent(RuntimeEvent.CONTINUE, this.currentThread);
    await this.sendCommand("s");
    this.sendEvent(RuntimeEvent.STOP_ON_STEP, this.currentThread);
  }

  /**
   * Step out, finishing current opcode/call.
   * @param instruction If step granularity is for instructions.
   */
  public async stepOut(instruction: boolean): Promise<void> {
    this.sendEvent(RuntimeEvent.CONTINUE, this.currentThread);
    if (instruction) {
      await this.sendCommand("fc");
    } else {
      await this.sendCommand("f");
    }
    this.sendEvent(RuntimeEvent.STOP_ON_STEP, this.currentThread);
  }

  /**
   * Get the current stack.
   * @returns The current stack frames.
   */
  public async stack(): Promise<IRuntimeStack> {
    const { stack } = await this.sendCommand("stack");
    if (stack == null) {
      return { frames: [], count: 0 };
    }
    return stack;
  }

  /**
   * Get in scope variables.
   * @params signal Cancellation signal.
   * @returns The in scope variables.
   */
  public async getVariables(signal?: AbortSignal): Promise<RuntimeVariable[]> {
    try {
      let { values } = await this.sendCommand("vars", signal);
      values = Array.from(new Set(values)).sort();

      return await Promise.all(
        values.map(async (v) => {
          let { value } = await this.sendCommand("pp", signal, v);
          if (value != null) {
            // Get rid of excess whitespace and newlines
            value = collapseWhitespace(value);
          }
          return new RuntimeVariable(v, value);
        })
      );
    } catch (err) {
      if (err instanceof RuntimeCommandCancelled) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Get variable value by name.
   * @param name The name of the variable.
   * @param asLabel If variable should be of category label.
   * @returns The runtime variable value, or undefined if not set.
   */
  public async getVariable(name: string, asLabel = false): Promise<RuntimeVariable> {
    const { value } = await this.sendCommand("p", name);
    if (asLabel) {
      return new RuntimeLabel(name, value);
    } else {
      return new RuntimeVariable(name, value);
    }
  }

  /**
   * Get raw variable value by name.
   * @param name The name of the variable.
   * @param asLabel If variable should be of category label.
   * @returns The runtime variable value (without comments), or undefined if not set.
   */
  public async getVariableRaw(name: string, asLabel = false): Promise<RuntimeVariable> {
    const { value } = await this.sendCommand("pv", name);
    if (asLabel) {
      return new RuntimeLabel(name, value);
    } else {
      return new RuntimeVariable(name, value);
    }
  }

  /**
   * Get raw variable preview. (value is truncated when over 1kb in size)
   * @param name The name of the variable.
   * @param asLabel If variable should be of category label.
   * @returns The runtime variable value (without comments), or undefined if not set.
   */
  public async getVariablePreview(name: string, asLabel = false): Promise<RuntimeVariable> {
    const { value } = await this.sendCommand("pp", name);
    if (asLabel) {
      return new RuntimeLabel(name, value);
    } else {
      return new RuntimeVariable(name, value);
    }
  }

  /**
   * Set a variable value.
   * @param variable The variable to update.
   */
  public async setVariable(variable: RuntimeVariable): Promise<void> {
    let command = "";
    switch (variable.category) {
      case "var":
        command = `(assign (assoc ${variable.name} ${variable.value}))`;
        break;
      case "label":
        command = `(assign_to_entities (assoc ${variable.name} ${variable.value}))`;
        break;
      case "entity":
        break;
    }
    if (command !== "") {
      await this.sendCommand("eval", prepareExpression(command));
    }
  }

  /**
   * Get labels for entity.
   * @param name The entity name. Uses current entity if not provided.
   * @returns The labels as lazy variables.
   */
  public async getLabels(name?: string): Promise<RuntimeLabel[]> {
    let values: string[];
    if (name != null) {
      ({ values = [] } = await this.sendCommand("labels", name));
    } else {
      ({ values = [] } = await this.sendCommand("labels"));
    }
    return values.sort().map((v) => new RuntimeLabel(v, undefined, true));
  }

  /**
   * Get contained entities.
   * @returns The contained entities.
   */
  public async getEntities(): Promise<RuntimeEntity[]> {
    const { values = [] } = await this.sendCommand("entities");
    return values.sort().map((v) => new RuntimeEntity(v, undefined, true));
  }

  /**
   * Get entity value by name.
   * @param name The entity name.
   * @returns The entity value.
   */
  public async getEntity(name: string): Promise<RuntimeEntity> {
    const { value } = await this.sendCommand("entity", name);
    return new RuntimeEntity(name, value);
  }

  /**
   * Evaluate an expression.
   * @param expression The expression.
   * @returns The expression result.
   */
  public async evaluate(expression: string): Promise<RuntimeVariable> {
    const { value } = await this.sendCommand("eval", prepareExpression(expression));
    return new RuntimeVariable("eval", value);
  }

  /**
   * Retrieve all thread IDs.
   * @returns The list of thread IDs.
   */
  public async getThreadIds(): Promise<string[]> {
    const { threads } = await this.sendCommand("threads");
    return threads;
  }

  /**
   * Clear breakpoints.
   * @param path The absolute source path to clear breakpoints for. If undefined, all breakpoints will be cleared.
   */
  public async clearBreakpoints(path?: string): Promise<void> {
    let breakpoints: IRuntimeBreakpoint[] = [];
    if (path == null) {
      // All sources
      for (const [, bps] of this.breakpoints) {
        breakpoints.push(...bps);
      }
    } else {
      // Single source
      breakpoints = this.breakpoints.get(path) || [];
    }

    // Clear verified breakpoints
    for (const br of breakpoints) {
      if (br.verified) {
        await this.sendCommand("bn", br.line, br.path);
      }
    }

    // Remove handles
    if (path) {
      this.breakpoints.delete(path);
    } else {
      this.breakpoints.clear();
    }
  }

  /**
   * Create a new breakpoint.
   * @param path The absolute source path.
   * @param line The line number of the breakpoint.
   * @param column The column number of the breakpoint.
   * @returns The breakpoint object.
   */
  public async setBreakPoint(path: string, line: number, column = 0): Promise<IRuntimeBreakpoint> {
    const bp: IRuntimeBreakpoint = { verified: false, path, line, column, id: this.breakpointId++ };
    let bps = this.breakpoints.get(path);
    if (!bps) {
      bps = new Array<IRuntimeBreakpoint>();
      this.breakpoints.set(path, bps);
    }
    bps.push(bp);

    if (this.isRunning) {
      const { action } = await this.sendCommand("bn", line, path);
      if (action === "added") {
        bp.verified = true;
      }
    }

    return bp;
  }

  /**
   * Verify breakpoints are set.
   * @param path The absolute source path to verify.
   */
  private async verifyBreakpoints(path?: string): Promise<void> {
    let breakpoints: IRuntimeBreakpoint[] = [];
    if (path == null) {
      // All sources
      for (const [, bps] of this.breakpoints) {
        breakpoints.push(...bps);
      }
    } else {
      // Single source
      breakpoints = this.breakpoints.get(path) || [];
    }

    for (const br of breakpoints) {
      if (!br.verified) {
        const { action } = await this.sendCommand("bn", br.line, br.path);
        if (action === "added") {
          br.verified = true;
          this.sendEvent(RuntimeEvent.BREAKPOINT_VALIDATED, br);
        }
      }
    }
  }

  /**
   * Spawn the Amalgam process.
   * @param options Launch options.
   * @returns The child process.
   */
  private spawnAmalgam(options: IRuntimeLaunchOptions, debug = true) {
    const { executable, args = [], program } = options;
    const allArgs = [...args, `"${program}"`];
    if (debug) {
      allArgs.unshift("--debug-minimal", "--debug-sources");
    }

    logger.debug("Launch args:", allArgs);
    logger.debug("Launch cwd:", options.cwd);

    const child = spawn(`"${executable}"`, allArgs, {
      cwd: options.cwd,
      shell: true,
      env: {
        VSCODE_DEBUG_SESSION: "1",
        ...options.env,
      },
    });
    child.stdin?.setDefaultEncoding("utf8");
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    // Log output
    child.stdout?.on("data", (data) => {
      logger.log("stdout", data);
    });
    child.stderr?.on("data", (data) => {
      logger.log("stderr", data);
    });
    child.on("close", (code) => {
      logger.log("cpinfo", `Child process exited with code: ${code}`);
      this.sendEvent(RuntimeEvent.END);
    });
    child.on("error", (error) => {
      logger.log("cpinfo", `cp.error:${error.message}`);
    });
    return child;
  }

  /**
   * Send event to debugger session.
   * @param event The event name.
   * @param args Additional event arguments.
   */
  private sendEvent(event: RuntimeEvent, ...args: unknown[]): void {
    this.emit(event, ...args);
  }

  /**
   * Send command to the Amalgam runtime process.
   * @param command The command to send.
   * @param signal A cancel token signal.
   * @param args Additional command arguments.
   */
  private async sendCommand<C extends IRuntimeCommand>(command: C, ...args: unknown[]): Promise<IRuntimeResult<C>>;
  private async sendCommand<C extends IRuntimeCommand>(
    command: C,
    signal?: AbortSignal,
    ...args: unknown[]
  ): Promise<IRuntimeResult<C>> {
    let task: IRuntimeTask;
    if (signal instanceof AbortSignal) {
      if (signal.aborted) {
        throw new RuntimeCommandCancelled();
      }
      task = { command, args, signal };
    } else {
      // "signal" overloaded as first arg
      if (signal !== undefined) {
        args.unshift(signal);
      }
      task = { command, args };
    }

    return new Promise((resolve, reject) => {
      this.commandQueue.push<IRuntimeResult<C>>(task, (err, response) => {
        if (err) {
          reject(err);
        } else if (response === undefined) {
          reject(new InvalidRuntimeResponse("Command response undefined"));
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Handle stdout/stderr from child process.
   * @param source The data source of the output.
   * @param data The current buffer received from the stream.
   */
  private handleOutput(source: DataSource, data: string): void {
    if (this.ignoreOutput) {
      // Avoid handling output after debugging has stopped
      return;
    }

    // Handle errors
    if (source === "stderr") {
      this.sendEvent(RuntimeEvent.OUTPUT, source, data);
      return;
    }

    // Concatenate the data into the buffer
    data = data.replaceAll("\r\n", "\n");
    this.outputBuffer += data;

    this.outputToDebugConsole(source, data);

    const command = this.activeCommand;
    let lines = this.outputBuffer;
    let reg: RegExp;
    let matches: RegExpExecArray | null;

    // Check for end of data
    reg = new RegExp(this.matchers.end);
    const eot = reg.exec(lines);
    if (eot == null) {
      return;
    } else {
      // Remove termination characters
      lines = lines.substring(0, eot.index) + lines.substring(eot.index + eot[0].length + 1);
    }

    if (eot.groups?.thread != null) {
      this._currentThread = parseInt(eot.groups?.thread);
    }

    if (command == null) {
      if (this.commandQueue.paused) {
        // Consume initial startup output before issuing any commands
        this.debugStarted.notify(null);
        this.commandQueue.resume();
      }
      this.outputBuffer = "";
      return;
    }

    // Match expression
    let expressionResult: string | undefined = undefined;
    if (["p", "pv", "pp", "eval", "entity"].indexOf(command) >= 0) {
      reg = new RegExp(this.matchers.expression);
      while ((matches = reg.exec(lines)) != null) {
        if (matches.groups) {
          expressionResult = matches.groups.value;
        }
      }
    }

    // Match vars/labels/entities
    const varsResult: string[] = [];
    if (["vars", "labels", "entities"].indexOf(command) >= 0) {
      reg = new RegExp(this.matchers.lines);
      while ((matches = reg.exec(lines)) != null) {
        if (matches.groups) {
          varsResult.push(matches.groups.line);
        }
      }
    }

    // Match list breakpoints
    const breakpoints: IRuntimeInternalBreakpoint[] = [];
    if (command === "br") {
      reg = new RegExp(this.matchers.breakpoints);
      while ((matches = reg.exec(lines)) != null) {
        if (matches.groups) {
          const type = matches.groups.type;
          if (type === RuntimeBreakpointType.LINE) {
            let brMatches: RegExpExecArray | null;
            const sectionReg = new RegExp(this.matchers.breakpointLine);
            while ((brMatches = sectionReg.exec(matches.groups.brs))) {
              if (brMatches.groups) {
                breakpoints.push({
                  line: parseInt(brMatches.groups.line),
                  column: 0,
                  path: brMatches.groups.file,
                });
              }
            }
          }
        }
      }
    }

    // Match toggle breakpoint
    let breakpointAction: IRuntimeBreakpointAction = null;
    if (command === "bn") {
      reg = new RegExp(this.matchers.breakpointAction);
      while ((matches = reg.exec(lines)) != null) {
        if (matches.groups) {
          breakpointAction = matches.groups.action.toLowerCase() as IRuntimeBreakpointAction;
        }
      }
    }

    // Match stack
    let stack: IRuntimeStack | undefined = undefined;
    if (command === "stack") {
      reg = new RegExp(this.matchers.stack);
      while ((matches = reg.exec(lines)) != null) {
        if (matches.groups) {
          const type = matches.groups.type;
          if (type !== RuntimeStackType.INTERPRET_NODE && type !== RuntimeStackType.OPCODE) {
            continue;
          }
          let frameReg: RegExp;
          let frameMatches: RegExpExecArray | null;
          let index = 0;
          const frames: IRuntimeStackFrame[] = [];
          const opcodes: string[] = [];

          // First collect all opcodes
          frameReg = new RegExp(this.matchers.stackFrameOpcode);
          while ((frameMatches = frameReg.exec(matches.groups.frames))) {
            if (frameMatches.groups) {
              opcodes.push(frameMatches.groups.opcode);
            }
          }

          // Build the stack frame from the comment line
          frameReg = new RegExp(this.matchers.stackFrameComment);
          while ((frameMatches = frameReg.exec(matches.groups.frames))) {
            if (frameMatches.groups) {
              const opcode = opcodes[index];
              const stackFrame: IRuntimeStackFrame = {
                index: index++,
                name: opcode,
                line: parseInt(frameMatches.groups.line),
                column: parseInt(frameMatches.groups.column),
                file: frameMatches.groups.file,
              };
              frames.push(stackFrame);
            }
          }
          stack = { frames: frames.reverse(), count: frames.length };
        }
      }
    }

    // Match threads
    const threads: string[] = [];
    if (command === "threads") {
      reg = new RegExp(this.matchers.lines);
      while ((matches = reg.exec(lines)) != null) {
        if (matches.groups) {
          threads.push(matches.groups.line);
        }
      }
    }

    // Clear the buffer
    this.outputBuffer = "";

    // Based on command executed, send appropriate event
    switch (command) {
      case "stack": {
        this.commandDone.notify({
          type: command,
          stack,
        });
        break;
      }
      case "threads": {
        this.commandDone.notify({
          type: command,
          threads,
        });
        break;
      }
      case "p":
      case "pv":
      case "pp":
      case "entity":
      case "eval": {
        this.commandDone.notify({
          type: command,
          value: expressionResult,
        });
        break;
      }
      case "entities":
      case "labels":
      case "vars": {
        this.commandDone.notify({
          type: command,
          values: varsResult,
        });
        break;
      }
      case "bn": {
        this.commandDone.notify({
          type: command,
          action: breakpointAction,
        });
        break;
      }
      case "br": {
        this.commandDone.notify({
          type: command,
          breakpoints,
        });
        break;
      }
      default:
        this.commandDone.notify({ type: command });
    }
  }

  protected outputToDebugConsole(source: DataSource, text: string): void {
    switch (this.activeCommand) {
      case undefined:
      case "c":
      case "s":
      case "n":
      case "f":
      case "fc":
      case "finish": {
        // Remove termination characters
        const reg = new RegExp(this.matchers.end);
        const eot = reg.exec(text);
        if (eot != null) {
          text = text.substring(0, eot.index) + text.substring(eot.index + eot[0].length + 1);
        }

        if (text !== "") {
          this.sendEvent(RuntimeEvent.OUTPUT, source, text);
        }
      }
    }
  }
}
