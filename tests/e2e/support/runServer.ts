import { DEFAULT_SERVER_PORT, DEFAULT_WORKSPACE_ROOT } from './fixtures.ts';
import { startE2EApp } from './e2eApp.ts';

const app = await startE2EApp({
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  port: DEFAULT_SERVER_PORT,
  syncEnabled: true,
});

console.log(`E2E server ready at ${app.baseUrl}`);

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
