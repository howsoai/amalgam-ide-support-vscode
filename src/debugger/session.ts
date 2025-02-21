import * as vscode from "vscode";
import {
  Logger,
  logger,
  LoggingDebugSession,
  InitializedEvent,
  TerminatedEvent,
  StoppedEvent,
  ContinuedEvent,
  Breakpoint,
  BreakpointEvent,
  OutputEvent,
  StackFrame,
  Scope,
  Source,
  Thread,
  Handles,
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { platform } from "os";
import * as path from "path";
import { existsSync as fileExists } from "fs";
import * as semver from "semver";
import { expandUserHome, NotifySubject, executeCommand } from "./utils";
import { AmalgamRuntime, IRuntimeBreakpoint, IRuntimeLaunchOptions, RuntimeEvent, RuntimeVariable } from "./runtime";
import { logger as outputLogger } from "../logging";

/**
 * This interface describes the Amalgam specific launch attributes (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json and should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  /** The path to the "program" to debug. */
  program: string;
  /** The absolute path to the amalgam executable (defaults to ~/.amalgam/bin/amalgam) */
  executable?: string;
  /** Additional cli arguments to pass to the amalgam executable. */
  args?: string[];
  /** A filepath to an amalgam trace file. */
  tracefile?: string;
  /** The program working directory */
  workingDirectory?: string;
  /** Automatically stop target after launch. If not specified, target does not stop. */
  stopOnEntry?: boolean;
  /** Enable logging the Debug Adapter Protocol. */
  logging?: boolean;
}

export class AmalgamDebugSession extends LoggingDebugSession {
  private runtime: AmalgamRuntime;
  private workingDirectory: string | undefined;

  private configurationDone = new NotifySubject<null>();
  private cancellationTokens = new Map<number, AbortController>();
  private _variableHandles = new Handles<"vars" | "labels" | "entities" | RuntimeVariable>();

  public readonly parentSession: vscode.DebugSession;

  public constructor(session: vscode.DebugSession) {
    super();
    this.parentSession = session;

    // The Amalgam debugger uses one-based lines and columns starting with version 50.0.2
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);

    this.runtime = new AmalgamRuntime();

    // Handle stop on program start
    this.runtime.on(RuntimeEvent.STOP_ON_ENTRY, (threadId: number) => {
      const event: DebugProtocol.StoppedEvent = new StoppedEvent("entry", threadId);
      event.body.allThreadsStopped = true;
      this.sendEvent(event);
    });

    // Handle stop on stepping
    this.runtime.on(RuntimeEvent.STOP_ON_STEP, (threadId: number) => {
      const event: DebugProtocol.StoppedEvent = new StoppedEvent("step", threadId);
      event.body.allThreadsStopped = true;
      this.sendEvent(event);
    });

    // Handle stop on hitting breakpoint
    this.runtime.on(RuntimeEvent.STOP_ON_BREAKPOINT, (threadId: number) => {
      const event: DebugProtocol.StoppedEvent = new StoppedEvent("breakpoint", threadId);
      event.body.allThreadsStopped = true;
      this.sendEvent(event);
    });

    // Handle stop on raised exceptions
    this.runtime.on(RuntimeEvent.STOP_ON_EXCEPTION, (exception, threadId: number) => {
      let event: DebugProtocol.StoppedEvent;
      if (exception) {
        event = new StoppedEvent(`exception(${exception})`, threadId);
      } else {
        event = new StoppedEvent("exception", threadId);
      }
      event.body.allThreadsStopped = true;
      this.sendEvent(event);
    });

    // Update breakpoints when validated
    this.runtime.on(RuntimeEvent.BREAKPOINT_VALIDATED, (bp: IRuntimeBreakpoint) => {
      this.sendEvent(new BreakpointEvent("changed", { verified: bp.verified, id: bp.id } as DebugProtocol.Breakpoint));
    });

    // Handle continuation
    this.runtime.on(RuntimeEvent.CONTINUE, (threadId: number) => {
      this.sendEvent(new ContinuedEvent(threadId, true));
    });

    // Handle debugger termination
    this.runtime.on(RuntimeEvent.END, () => {
      this.sendEvent(new TerminatedEvent());
    });

    // Handle output to debugger logs
    this.runtime.on(
      RuntimeEvent.OUTPUT,
      (type: string, text: string, path?: string, line?: number, column?: number) => {
        let category: string;
        if (type === "important" || type === "stdout" || type === "stderr") {
          category = type;
        } else {
          category = "console";
        }
        const evt: DebugProtocol.OutputEvent = new OutputEvent(`${text}`, category);
        if (path) {
          evt.body.source = this.createSource(path);
        }
        if (line) {
          evt.body.line = this.convertDebuggerLineToClient(line);
        }
        if (column) {
          evt.body.column = this.convertDebuggerColumnToClient(column);
        }
        this.sendEvent(evt);
      }
    );
  }

  protected async continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
    this.sendResponse(response);
    await this.runtime.continue();
  }

  protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
    this.sendResponse(response);
    await this.runtime.step(args.granularity === "instruction");
  }

  protected async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
    this.sendResponse(response);
    await this.runtime.stepIn();
  }

  protected async stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    args: DebugProtocol.StepOutArguments
  ): Promise<void> {
    this.sendResponse(response);
    await this.runtime.stepOut(args.granularity === "instruction");
  }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    const sourcePath = this.convertPathToRuntime(args.source.path as string);
    const clientBreakpoints = args.breakpoints || [];

    // clear all breakpoints for this file
    await this.runtime.clearBreakpoints(sourcePath);

    // set and verify breakpoint locations
    const allBreakpoints = await Promise.all(
      clientBreakpoints.map(async (br) => {
        const { verified, line, column, path, id } = await this.runtime.setBreakPoint(
          sourcePath,
          this.convertClientLineToDebugger(br.line),
          br.column ? this.convertClientColumnToDebugger(br.column) : 0
        );
        const bp = new Breakpoint(
          verified,
          this.convertDebuggerLineToClient(line),
          this.convertDebuggerColumnToClient(column),
          this.createSource(path)
        );
        bp.setId(id);
        return bp;
      })
    );

    // send back the actual breakpoint positions
    response.body = {
      breakpoints: allBreakpoints,
    };
    this.sendResponse(response);
  }

  protected async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ): Promise<void> {
    // Stack only available for current thread
    if (this.runtime.currentThread != args.threadId) {
      this.sendResponse(response);
      return;
    }

    const stk = await this.runtime.stack();

    response.body = {
      stackFrames: stk.frames.map((f) => {
        const sf: DebugProtocol.StackFrame = new StackFrame(
          f.index,
          f.name,
          this.createSource(f.file),
          this.convertDebuggerLineToClient(f.line),
          this.convertDebuggerColumnToClient(f.column)
        );
        // if (typeof f.instruction === "number") {
        //   const address = f.instruction;
        //   sf.name = `${f.name} ${address}`;
        //   sf.instructionPointerReference = address;
        // }

        // Subtly change appearance if frame is for a label
        if (f.name.startsWith("#")) {
          sf.presentationHint = "subtle";
        }

        return sf;
      }),
      totalFrames: stk.count,
    };
    this.sendResponse(response);
  }

  protected async evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): Promise<void> {
    let reply: string | undefined;
    let rv: RuntimeVariable | undefined;

    switch (args.context) {
      case "repl": {
        const CMD_REGEXP = /^~(?<cmd>entities)(?: (?<args>.+))?$/i;
        const match = CMD_REGEXP.exec(args.expression);
        if (match?.groups) {
          // Handle custom commands
          switch (match.groups.cmd) {
            case "entities": {
              const entities = await this.runtime.getEntities();
              reply = entities.map((e) => e.name).join("\n");
              break;
            }
          }
        } else {
          // Evaluate expression
          rv = await this.runtime.evaluate(args.expression);
        }
        break;
      }
      case "watch":
        rv = await this.runtime.evaluate(args.expression);
        break;
      case "hover":
        if (args.expression.startsWith("(") && args.expression.endsWith(")")) {
          // Evaluate opcode expression
          rv = await this.runtime.evaluate(args.expression);
        } else {
          // Get variable value
          rv = await this.runtime.getVariablePreview(args.expression);
        }
        break;
      case "variables":
      case "clipboard":
      default: {
        const [category, expr] = args.expression.split(" ");
        if (expr === undefined) {
          // No category defined, category is expr
          rv = await this.runtime.getVariablePreview(category);
        } else {
          if (category === "entity") {
            rv = await this.runtime.getEntity(expr);
          } else {
            rv = await this.runtime.getVariablePreview(expr, category === "label");
          }
        }
        break;
      }
    }

    if (rv) {
      const v = this.convertDebuggerVariableToClient(rv);
      response.body = {
        result: v.value,
        variablesReference: v.variablesReference,
        presentationHint: v.presentationHint,
      };
    } else {
      response.body = {
        result: reply || "???",
        variablesReference: 0,
      };
    }

    this.sendResponse(response);
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse): void {
    response.body = {
      scopes: [
        new Scope("Variables", this._variableHandles.create("vars"), true),
        new Scope("Labels", this._variableHandles.create("labels"), true),
        new Scope("Entities", this._variableHandles.create("entities"), true),
      ],
    };
    this.sendResponse(response);
  }

  protected async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
    request?: DebugProtocol.Request
  ): Promise<void> {
    let vs: RuntimeVariable[] = [];

    const cancelToken = new AbortController();
    if (request) {
      this.cancellationTokens.set(request.seq, cancelToken);
    }

    try {
      const v = this._variableHandles.get(args.variablesReference);
      if (v === "vars") {
        vs = await this.runtime.getVariables(cancelToken.signal);
      } else if (v === "labels") {
        vs = await this.runtime.getLabels();
      } else if (v === "entities") {
        vs = await this.runtime.getEntities();
      } else if (v != null) {
        if (Array.isArray(v.value)) {
          vs = v.value;
        } else if (v.category === "entity") {
          vs = [await this.runtime.getEntity(v.name)];
        } else if (v.lazy) {
          vs = [await this.runtime.getVariablePreview(v.name, v.category === "label")];
        } else {
          vs = [v];
        }
      }
    } finally {
      if (request) {
        this.cancellationTokens.delete(request.seq);
      }
    }

    response.body = {
      variables: vs.map((v) => this.convertDebuggerVariableToClient(v)),
    };
    this.sendResponse(response);
  }

  protected async setVariableRequest(
    response: DebugProtocol.SetVariableResponse,
    args: DebugProtocol.SetVariableArguments
  ): Promise<void> {
    const container = this._variableHandles.get(args.variablesReference);

    let rv: RuntimeVariable | undefined = undefined;

    if (container === "vars") {
      rv = await this.runtime.getVariablePreview(args.name);
    } else if (container === "labels") {
      rv = await this.runtime.getVariablePreview(args.name, true);
    } else if (container instanceof RuntimeVariable) {
      if (Array.isArray(container.value)) {
        rv = container.value.find((v) => v.name === args.name);
      } else {
        rv = container;
      }
    }

    if (rv) {
      rv.value = args.value;
      await this.runtime.setVariable(rv);
      response.body = this.convertDebuggerVariableToClient(rv);
    }

    this.sendResponse(response);
  }

  protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
    if (args.requestId) {
      const cancelToken = this.cancellationTokens.get(args.requestId);
      cancelToken?.abort();
    }
  }

  /**
   * Called at the end of the configuration sequence.
   * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
   */
  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    super.configurationDoneRequest(response, args);

    // notify the launchRequest that configuration has finished
    this.configurationDone.notify(null);
  }

  /**
   * The 'initialize' request is the first request called by the frontend
   * to interrogate the features the debug adapter provides.
   */
  protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
    // build and return the capabilities of this debug adapter:
    response.body = response.body || {};

    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsCancelRequest = true;
    response.body.supportSuspendDebuggee = false;
    response.body.supportTerminateDebuggee = true;

    response.body.supportsSetVariable = true;
    response.body.supportsSteppingGranularity = true;

    // make VS Code use 'evaluate' when hovering over source
    response.body.supportsEvaluateForHovers = true;

    // support completions in REPL
    response.body.supportsCompletionsRequest = true;
    response.body.completionTriggerCharacters = ["~"];

    // make VS Code support different breakpoint types
    response.body.supportsDataBreakpoints = false;
    response.body.supportsFunctionBreakpoints = false;
    response.body.supportsInstructionBreakpoints = false;
    response.body.supportsConditionalBreakpoints = false;

    this.sendResponse(response);
  }

  protected completionsRequest(response: DebugProtocol.CompletionsResponse): void {
    response.body = {
      targets: [
        {
          label: "entities",
          detail: "Print out the contained entities.",
          type: "method",
        },
      ],
    };
    this.sendResponse(response);
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
    // make sure to 'Stop' the buffered logging if 'logging' is not set
    logger.setup(args.logging ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

    // Validate executable
    const executable = AmalgamDebugSession.getExecutablePath(args.executable);
    if (executable == null || !fileExists(executable)) {
      this.sendErrorResponse(response, {
        id: 1,
        format: "Amalgam executable not found at path:\n{executable}",
        variables: {
          executable,
        },
        showUser: true,
        sendTelemetry: false,
        url: "https://github.com/howsoai/amalgam",
        urlLabel: "Get Amalgam",
      });
      return;
    }

    // Validate working directory
    const workingDirectory = args.workingDirectory ? expandUserHome(args.workingDirectory) : undefined;
    if (workingDirectory != null && !fileExists(workingDirectory)) {
      this.sendErrorResponse(response, {
        id: 2,
        format: "The provided working directory does not exist:\n{workingDirectory}",
        variables: {
          workingDirectory,
        },
        showUser: true,
        sendTelemetry: false,
      });
      return;
    }

    // Resolve working directory and program file paths
    let program = expandUserHome(args.program);
    if (workingDirectory) {
      program = path.resolve(workingDirectory, program);
    }
    const programUri = vscode.Uri.parse(program);
    const workspaceUri = vscode.workspace.getWorkspaceFolder(programUri)?.uri;
    const cwd = workingDirectory || path.dirname(programUri.fsPath);
    const runtimeArgs: string[] = args.args || [];

    this.workingDirectory = cwd || workspaceUri?.fsPath;

    // Update debugger configuration based binary version
    try {
      const executableVersion = await this.getExecutableVersion(executable);
      outputLogger.info(`Amalgam Version: ${executableVersion}`);
      if (semver.gt(executableVersion, "0.0.0") && semver.lt(executableVersion, "50.0.2")) {
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);
        outputLogger.debug("Line numbers set to 0-based");
      }
    } catch (error) {
      this.sendErrorResponse(response, {
        id: 3,
        format: "Error: Failed to verify Amalgam binary version.",
        showUser: true,
        sendTelemetry: false,
      });
      return;
    }

    // Tell the front end to initialize. Normally this could be done during initializeRequest but
    // we must do this after interrogating the executable version to apply version based configurations.
    // The frontend will end the configuration sequence by calling 'configurationDone' request.
    this.sendEvent(new InitializedEvent());

    // wait up to 5 seconds until configuration has finished (and configurationDone has been called)
    await this.configurationDone.wait(5000);

    if (args.tracefile) {
      // if a tracefile is defined, add it to the runtime arguments
      const tracefile = cwd ? path.resolve(cwd, args.tracefile) : args.tracefile;
      runtimeArgs.push("--tracefile", `"${tracefile}"`);
    }

    const startArgs: IRuntimeLaunchOptions = {
      cwd,
      executable,
      args: runtimeArgs,
      program: programUri.fsPath,
    };

    // start the program in the runtime
    const started = await this.runtime.start(startArgs, !!args.stopOnEntry, !args.noDebug);

    if (started) {
      this.sendResponse(response);
    } else {
      this.sendErrorResponse(response, {
        id: 1001,
        format: "Error: Failed to start Amalgam runtime.",
        showUser: true,
        sendTelemetry: false,
      });
    }
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): void {
    if (args.terminateDebuggee) {
      this.runtime?.terminate();
    }
  }

  protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
    const threadIds = await this.runtime.getThreadIds();
    if (threadIds.length > 0) {
      response.body = {
        threads: threadIds.map((threadId) => new Thread(parseInt(threadId), `thread ${threadId}`)),
      };
    } else {
      response.body = {
        threads: [new Thread(AmalgamRuntime.DEFAULT_THREAD_ID, "main")],
      };
    }
    this.sendResponse(response);
  }

  /**
   * Resolve path to Amalgam executable.
   * @param filePath Custom specified path.
   * @returns The resolved path to Amalgam executable.
   */
  public static getExecutablePath(filePath?: string): string {
    if (filePath == null) {
      // Use default path
      const executableName = AmalgamRuntime.getExecutableName();
      filePath = path.resolve(expandUserHome(AmalgamRuntime.DEFAULT_EXECUTABLE_DIR), executableName);
    } else {
      // Configured path
      filePath = path.resolve(expandUserHome(filePath));
    }
    return filePath;
  }

  protected async getExecutableVersion(executable: string): Promise<semver.SemVer> {
    const result = await executeCommand(executable, "--version");
    return new semver.SemVer(result, { loose: true });
  }

  private createSource(filePath: string): Source {
    if (this.workingDirectory) {
      filePath = path.resolve(this.workingDirectory, filePath);
    }
    return new Source(path.basename(filePath), this.convertDebuggerPathToClient(filePath));
  }

  protected convertPathToRelative(filePath: string): string {
    if (this.workingDirectory) {
      filePath = path.relative(this.workingDirectory, filePath);
    }
    return filePath;
  }

  protected convertPathToRuntime(filePath: string): string {
    filePath = this.convertClientPathToDebugger(filePath);
    if (this.workingDirectory) {
      filePath = path.resolve(this.workingDirectory, filePath);
    }
    if (platform() == "win32") {
      filePath = path.win32.normalize(filePath);
      return filePath.charAt(0).toUpperCase() + filePath.slice(1);
    } else {
      return path.normalize(filePath);
    }
  }

  protected convertDebuggerVariableToClient(variable: RuntimeVariable): DebugProtocol.Variable {
    const dapVariable: DebugProtocol.Variable = {
      name: variable.name,
      value: "???",
      variablesReference: 0,
      evaluateName: `${variable.category} ${variable.name}`,
    };
    if (variable.lazy) {
      variable.reference ??= this._variableHandles.create(variable);
      dapVariable.variablesReference = variable.reference;
      dapVariable.value = "";
      dapVariable.presentationHint = {
        lazy: variable.lazy,
      };
    } else {
      if (Array.isArray(variable.value)) {
        dapVariable.value = "Object";
        variable.reference ??= this._variableHandles.create(variable);
        dapVariable.variablesReference = variable.reference;
      } else if (variable.value != null) {
        dapVariable.value = variable.value;
      }
    }
    return dapVariable;
  }
}
