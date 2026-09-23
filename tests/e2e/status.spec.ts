import { expect, test } from '@playwright/test';
import { resetDefaultServerState } from './support/fixtures.ts';

test.beforeEach(async () => {
  await resetDefaultServerState();
});

test('triggers a dry-run sync and streams live log updates over SSE', async ({ page }) => {
  await page.goto('/status.html');

  await expect(page.locator('#sync-enabled')).toContainText('Enabled');
  await expect(page.locator('#sync-dry-run')).toBeChecked();

  await page.getByRole('button', { name: 'Sync now' }).click();

  await expect(page.locator('#live-log-output')).toContainText('Scanning vault');
  await expect(page.locator('#live-log-output')).toContainText('Would upload: Eligible/keep.md');
  await expect(page.locator('#sync-status')).toContainText('Dry run success: uploaded 1, skipped 0, removed 0, failed 0');
});
