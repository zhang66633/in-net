type LogLevel = "info" | "debug" | "error";

interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  [key: string]: unknown;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err?: Error): void;
}

let globalDebug = false;

export function setDebug(enabled: boolean): void {
  globalDebug = enabled;
}

function emit(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger: Logger = {
  info(msg, data) {
    emit({ level: "info", ts: new Date().toISOString(), msg, ...data });
  },
  debug(msg, data) {
    if (globalDebug) {
      emit({ level: "debug", ts: new Date().toISOString(), msg, ...data });
    }
  },
  error(msg, err) {
    emit({
      level: "error",
      ts: new Date().toISOString(),
      msg,
      error: err?.message,
      stack: err?.stack,
    });
  },
};
