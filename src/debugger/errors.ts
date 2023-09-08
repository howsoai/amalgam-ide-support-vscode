export class RuntimeError extends Error {
  constructor(public readonly reason: string, message?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}

export class RuntimeNotStarted extends RuntimeError {
  constructor(message?: string) {
    super("not started", message);
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}

export class RuntimeCommandCancelled extends RuntimeError {
  constructor(message?: string) {
    super("command cancelled", message);
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}

export class InvalidRuntimeResponse extends RuntimeError {
  constructor(message?: string) {
    super("invalid response", message);
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}
