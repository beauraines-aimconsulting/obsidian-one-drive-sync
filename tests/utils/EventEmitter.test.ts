import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from '../../src/utils/EventEmitter.js';

describe('EventEmitter', () => {
  let emitter: EventEmitter<unknown>;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('should register event listener', () => {
    const handler = vi.fn();
    emitter.on('test', handler);
    expect(emitter.listenerCount('test')).toBe(1);
  });

  it('should emit event to listeners', async () => {
    const handler = vi.fn();
    emitter.on('test', handler);
    await emitter.emit('test', { data: 'test' });
    expect(handler).toHaveBeenCalledWith({ data: 'test' });
  });

  it('should handle multiple listeners', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.on('test', handler1);
    emitter.on('test', handler2);
    await emitter.emit('test', { data: 'test' });
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('should remove specific listener', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.on('test', handler1);
    emitter.on('test', handler2);
    emitter.off('test', handler1);
    await emitter.emit('test', { data: 'test' });
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('should handle once listeners', async () => {
    const handler = vi.fn();
    emitter.once('test', handler);
    await emitter.emit('test', { data: 'test' });
    await emitter.emit('test', { data: 'test' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should remove all listeners for event', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.on('test', handler1);
    emitter.on('test', handler2);
    emitter.removeAllListeners('test');
    await emitter.emit('test', { data: 'test' });
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should remove all listeners globally', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.on('test1', handler1);
    emitter.on('test2', handler2);
    emitter.removeAllListeners();
    await emitter.emit('test1', { data: 'test' });
    await emitter.emit('test2', { data: 'test' });
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should return event names', () => {
    emitter.on('test1', () => {});
    emitter.on('test2', () => {});
    const names = emitter.eventNames();
    expect(names).toContain('test1');
    expect(names).toContain('test2');
  });

  it('should return correct listener count', () => {
    emitter.on('test', () => {});
    emitter.on('test', () => {});
    expect(emitter.listenerCount('test')).toBe(2);
  });

  it('should handle emit with no listeners', async () => {
    await expect(emitter.emit('nonexistent', { data: 'test' })).resolves.toBeUndefined();
  });

  it('should remove only listeners for the requested event', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.on('test1', handler1);
    emitter.on('test2', handler2);

    emitter.removeAllListeners('test1');

    expect(emitter.listenerCount('test1')).toBe(0);
    expect(emitter.listenerCount('test2')).toBe(1);

    await emitter.emit('test1', { data: 'test' });
    await emitter.emit('test2', { data: 'test' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('should await async listeners before resolving emit', async () => {
    const calls: string[] = [];
    emitter.on('test', async () => {
      calls.push('listener-start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push('listener-end');
    });

    await emitter.emit('test', { data: 'test' });

    expect(calls).toEqual(['listener-start', 'listener-end']);
  });
});
