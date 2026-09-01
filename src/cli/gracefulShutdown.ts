export interface StoppableWatcher {
  unwatch(): Promise<void>;
}

export interface ShutdownLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface StoppableHealthServer {
  stop(): Promise<void>;
}

/**
 * Creates an idempotent shutdown handler that stops incoming file events and
 * waits for evaluations already in progress before allowing the process to exit.
 */
export function createGracefulShutdown(
  watcher: StoppableWatcher,
  pendingEvaluations: Set<Promise<void>>,
  logger: ShutdownLogger,
  healthServer?: StoppableHealthServer
): (signal: string) => Promise<number> {
  let shutdownPromise: Promise<number> | undefined;

  return async (signal: string): Promise<number> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async (): Promise<number> => {
      logger.info(`Shutting down on ${signal}`);

      try {
        await healthServer?.stop();
        await watcher.unwatch();
        await Promise.allSettled(pendingEvaluations);
        return 0;
      } catch (error) {
        logger.error(
          `Failed to shut down cleanly: ${error instanceof Error ? error.message : String(error)}`
        );
        return 1;
      }
    })();

    return shutdownPromise;
  };
}
