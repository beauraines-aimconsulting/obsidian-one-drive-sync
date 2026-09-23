import type { SyncRunSnapshot } from './syncRuns.js';

export interface FileEvaluatedEvent {
  type: 'file-evaluated';
  timestamp: string;
  filepath: string;
  action: string;
  eligible?: boolean;
  reason?: string;
  error?: string;
  parseError?: boolean;
}

export interface SyncProgressEvent {
  type: 'sync-progress';
  timestamp: string;
  runId: string;
  message: string;
  source: 'web' | 'schedule';
  dryRun: boolean;
  force: boolean;
}

export interface SyncCompleteEvent {
  type: 'sync-complete';
  timestamp: string;
  run: SyncRunSnapshot;
}

export interface RulesUpdatedEvent {
  type: 'rules-updated';
  timestamp: string;
  etag: string;
}

export interface ScheduleRunEvent {
  type: 'schedule-run';
  timestamp: string;
  run: SyncRunSnapshot;
}

export type WebEvent =
  | FileEvaluatedEvent
  | SyncProgressEvent
  | SyncCompleteEvent
  | RulesUpdatedEvent
  | ScheduleRunEvent;

export type WebEventListener = (event: WebEvent) => void;

export class WebEventStream {
  private readonly listeners = new Set<WebEventListener>();

  constructor(private readonly maxListeners = 10) {}

  subscribe(listener: WebEventListener): boolean {
    if (this.listeners.size >= this.maxListeners) {
      return false;
    }

    this.listeners.add(listener);
    return true;
  }

  unsubscribe(listener: WebEventListener): void {
    this.listeners.delete(listener);
  }

  publish(event: WebEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A disconnected client can fail during a write between the close
        // event and its listener cleanup. Other subscribers must keep flowing.
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
