import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../src/utils/Logger.js';

describe('Logger', () => {
  let logger: Logger;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger('info');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should create a logger with default level', () => {
    expect(logger.getLevel()).toBe('info');
  });

  it('should create a logger with custom level', () => {
    const debugLogger = new Logger('debug');
    expect(debugLogger.getLevel()).toBe('debug');
  });

  it('should log at info level', () => {
    const infoLogger = new Logger('info');
    infoLogger.info('test message');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('INFO');
    expect(logSpy.mock.calls[0][0]).toContain('test message');
    expect(logSpy.mock.calls[0][0]).toContain('\x1b[32m');
  });

  it('should log at debug level when enabled', () => {
    const debugLogger = new Logger('debug');
    debugLogger.debug('debug message');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('DEBUG');
  });

  it('should not log debug when level is info', () => {
    const infoLogger = new Logger('info');
    infoLogger.debug('should not appear');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('should log error at any level', () => {
    const errorLogger = new Logger('error');
    errorLogger.error('error message');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('ERROR');
  });

  it('should set log level', () => {
    logger.setLevel('debug');
    expect(logger.getLevel()).toBe('debug');
  });

  it('should set context', () => {
    logger.setContext('TestContext');
    logger.info('test');
    expect(logSpy.mock.calls[0][0]).toContain('[TestContext]');
  });

  it('should create child logger with nested context', () => {
    const parent = new Logger('info', 'Parent');
    const child = parent.child('Child');
    child.info('child message');
    expect(logSpy.mock.calls[0][0]).toContain('[Parent:Child]');
  });

  it('should handle log with context object', () => {
    logger.info('message with context', { userId: 123, action: 'test' });
    expect(logSpy.mock.calls[0][0]).toContain(
      '{"userId":123,"action":"test"}'
    );
  });

  it('should log warn level', () => {
    logger.warn('warning message');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('WARN');
  });
});
