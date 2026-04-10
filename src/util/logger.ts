import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Plugin logger — writes JSON lines to:
 *   $WEIXIN_DATA_DIR/logs/hermes-weixin-YYYY-MM-DD.log
 */

const HOME = process.env.HERMES_HOME || process.env.HOME || os.homedir();
const MAIN_LOG_DIR = process.env.WEIXIN_DATA_DIR
  ? path.join(process.env.WEIXIN_DATA_DIR, "logs")
  : path.join(HOME, "components/weixin/logs");
const SUBSYSTEM = "hermes-weixin";

const LEVEL_IDS: Record<string, number> = {
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
};

const DEFAULT_LOG_LEVEL = "INFO";

function resolveMinLevel(): number {
  const env = process.env.WEIXIN_LOG_LEVEL?.toUpperCase();
  if (env && env in LEVEL_IDS) return LEVEL_IDS[env];
  return LEVEL_IDS[DEFAULT_LOG_LEVEL];
}

let minLevelId = resolveMinLevel();

export function setLogLevel(level: string): void {
  const upper = level.toUpperCase();
  if (!(upper in LEVEL_IDS)) {
    throw new Error(`Invalid log level: ${level}. Valid levels: ${Object.keys(LEVEL_IDS).join(", ")}`);
  }
  minLevelId = LEVEL_IDS[upper];
}

function toLocalISO(now: Date): string {
  const offsetMs = -now.getTimezoneOffset() * 60_000;
  const sign = offsetMs >= 0 ? "+" : "-";
  const abs = Math.abs(now.getTimezoneOffset());
  const offStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return new Date(now.getTime() + offsetMs).toISOString().replace("Z", offStr);
}

function localDateKey(now: Date): string {
  return toLocalISO(now).slice(0, 10);
}

function resolveMainLogPath(): string {
  const dateKey = localDateKey(new Date());
  return path.join(MAIN_LOG_DIR, `hermes-weixin-${dateKey}.log`);
}

let logDirEnsured = false;

export type Logger = {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  withAccount(accountId: string): Logger;
  getLogFilePath(): string;
  close(): void;
};

function buildLoggerName(accountId?: string): string {
  return accountId ? `${SUBSYSTEM}/${accountId}` : SUBSYSTEM;
}

function writeLog(level: string, message: string, accountId?: string): void {
  const levelId = LEVEL_IDS[level] ?? LEVEL_IDS.INFO;
  if (levelId < minLevelId) return;

  const now = new Date();
  const loggerName = buildLoggerName(accountId);
  const prefixedMessage = accountId ? `[${accountId}] ${message}` : message;
  const entry = JSON.stringify({
    name: loggerName,
    msg: prefixedMessage,
    time: toLocalISO(now),
    level,
  });
  try {
    if (!logDirEnsured) {
      fs.mkdirSync(MAIN_LOG_DIR, { recursive: true });
      logDirEnsured = true;
    }
    fs.appendFileSync(resolveMainLogPath(), `${entry}\n`, "utf-8");
  } catch {
    // Best-effort; never block on logging failures.
  }
}

function createLogger(accountId?: string): Logger {
  return {
    info(message: string): void { writeLog("INFO", message, accountId); },
    debug(message: string): void { writeLog("DEBUG", message, accountId); },
    warn(message: string): void { writeLog("WARN", message, accountId); },
    error(message: string): void { writeLog("ERROR", message, accountId); },
    withAccount(id: string): Logger { return createLogger(id); },
    getLogFilePath(): string { return resolveMainLogPath(); },
    close(): void { /* no-op */ },
  };
}

export const logger: Logger = createLogger();
