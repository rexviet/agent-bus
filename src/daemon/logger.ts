import pino from "pino";

export type DaemonLogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type DaemonLogger = pino.Logger;
export type DaemonLogDestination = pino.DestinationStream;

function daemonTimestamp(): string {
  return `,"timestamp":"${new Date().toISOString()}"`;
}

export function createDaemonLogger(
  level: DaemonLogLevel = "info",
  destination: DaemonLogDestination = pino.destination(2)
): DaemonLogger {
  return pino(
    {
      level,
      timestamp: daemonTimestamp
    },
    destination
  );
}
