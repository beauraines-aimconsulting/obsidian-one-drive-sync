import { seedFixtureWorkspace, DEFAULT_WORKSPACE_ROOT } from './support/fixtures.ts';

export default async function globalSetup(): Promise<void> {
  await seedFixtureWorkspace(DEFAULT_WORKSPACE_ROOT);
}
