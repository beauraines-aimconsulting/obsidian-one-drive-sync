import type { LogLevel } from './types.js';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};

const RESET_COLOR = '\x1b[0m';

export class Logger {
  private currentLevel: LogLevel;
  private context: string;

  constructor(level: LogLevel = 'info', context = '') {
    this.currentLevel = level;
    this.context = context;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.currentLevel];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): string {
    const timestamp = this.formatTimestamp();
    const contextStr = this.context ? ` [${this.context}]` : '';
    const contextData = context ? ` ${JSON.stringify(context)}` : '';
    return `${timestamp} ${level.toUpperCase()}${contextStr} ${message}${contextData}`;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.formatMessage(level, message, context);
    const color = LOG_COLORS[level];
    const coloredOutput = `${color}${formatted}${RESET_COLOR}`;

    if (level === 'error') {
      console.error(coloredOutput);
    } else if (level === 'warn') {
      console.warn(coloredOutput);
    } else {
      console.log(coloredOutput);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  getLevel(): LogLevel {
    return this.currentLevel;
  }

  setContext(context: string): void {
    this.context = context;
  }

  child(context: string): Logger {
    const childContext = this.context ? `${this.context}:${context}` : context;
    const child = new Logger(this.currentLevel, childContext);
    return child;
  }
}
