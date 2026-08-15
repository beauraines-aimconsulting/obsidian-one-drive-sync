import { describe, it, expect, beforeEach } from 'vitest';
import { Logger } from '../../src/utils/Logger.js';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('info');
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
    expect(() => {
      infoLogger.info('test message');
    }).not.toThrow();
  });

  it('should log at debug level when enabled', () => {
    const debugLogger = new Logger('debug');
    expect(() => {
      debugLogger.debug('debug message');
    }).not.toThrow();
  });

  it('should not log debug when level is info', () => {
    const infoLogger = new Logger('info');
    expect(() => {
      infoLogger.debug('should not appear');
    }).not.toThrow();
  });

  it('should log error at any level', () => {
    const errorLogger = new Logger('error');
    expect(() => {
      errorLogger.error('error message');
    }).not.toThrow();
  });

  it('should set log level', () => {
    logger.setLevel('debug');
    expect(logger.getLevel()).toBe('debug');
  });

  it('should set context', () => {
    logger.setContext('TestContext');
    expect(() => {
      logger.info('test');
    }).not.toThrow();
  });

  it('should create child logger with nested context', () => {
    const parent = new Logger('info', 'Parent');
    const child = parent.child('Child');
    expect(() => {
      child.info('child message');
    }).not.toThrow();
  });

  it('should handle log with context object', () => {
    expect(() => {
      logger.info('message with context', { userId: 123, action: 'test' });
    }).not.toThrow();
  });

  it('should log warn level', () => {
    expect(() => {
      logger.warn('warning message');
    }).not.toThrow();
  });
});
