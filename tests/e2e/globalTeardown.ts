import { removeRuntimeArtifacts } from './support/fixtures.ts';

export default async function globalTeardown(): Promise<void> {
  await removeRuntimeArtifacts();
}
