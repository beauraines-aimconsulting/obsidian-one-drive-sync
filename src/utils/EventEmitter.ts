export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

export class EventEmitter<T = unknown> {
  private listeners: Map<string, EventHandler<T>[]> = new Map();

  on(event: string, handler: EventHandler<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  once(event: string, handler: EventHandler<T>): void {
    const wrappedHandler: EventHandler<T> = async (data) => {
      await handler(data);
      this.off(event, wrappedHandler);
    };
    this.on(event, wrappedHandler);
  }

  off(event: string, handler: EventHandler<T>): void {
    if (!this.listeners.has(event)) {
      return;
    }
    const handlers = this.listeners.get(event)!;
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  async emit(event: string, data: T): Promise<void> {
    if (!this.listeners.has(event)) {
      return;
    }
    const handlers = this.listeners.get(event)!;
    await Promise.all(handlers.map((handler) => handler(data)));
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}
