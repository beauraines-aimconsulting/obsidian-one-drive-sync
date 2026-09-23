import { expect, test } from '@playwright/test';
import { startE2EApp } from './support/e2eApp.ts';
import { workspaceRootFor } from './support/fixtures.ts';

test('rejects unauthenticated page loads and API calls when a token is configured', async ({ page }) => {
  const app = await startE2EApp({
    workspaceRoot: workspaceRootFor('token-protected'),
    token: 'playwright-secret',
  });

  try {
    const [pageLoad, apiCall] = await Promise.all([
      fetch(`${app.baseUrl}/status.html`),
      fetch(`${app.baseUrl}/api/status`),
    ]);

    expect(pageLoad.status).toBe(401);
    expect(apiCall.status).toBe(401);

    await page.goto(`${app.baseUrl}/status.html?token=playwright-secret`);
    await expect(page.locator('#sync-enabled')).toContainText('Enabled');
  } finally {
    await page.goto('about:blank');
    await app.stop();
  }
});

test('disables save and sync controls in read-only mode', async ({ page }) => {
  const app = await startE2EApp({
    workspaceRoot: workspaceRootFor('read-only'),
    readOnly: true,
  });

  try {
    await page.goto(`${app.baseUrl}/status.html`);
    await expect(page.locator('#read-only-notice')).toBeVisible();
    await expect(page.locator('#sync-button')).toBeDisabled();

    await page.goto(`${app.baseUrl}/rules.html`);
    await expect(page.locator('#rules-banner')).toContainText('Read-only mode is enabled.');
    await expect(page.getByRole('button', { name: 'Save rules' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add definition' })).toBeDisabled();
    await expect(page.locator('#raw-editor')).toBeDisabled();
  } finally {
    await page.goto('about:blank');
    await app.stop();
  }
});
