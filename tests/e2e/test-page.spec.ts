import { expect, test } from '@playwright/test';
import {
  createCandidateRulesDocument,
  resetDefaultServerState,
} from './support/fixtures.ts';

test.beforeEach(async () => {
  await resetDefaultServerState();
});

test('evaluates a note against pending rules and renders pass/fail trace markers', async ({ page }) => {
  await page.goto('/test.html');

  await page.getByLabel('Find vault note').fill('missing-tag');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('#file-select')).toContainText('Eligible/missing-tag.md');

  await page.locator('#file-select').selectOption('Eligible/missing-tag.md');
  await page.getByRole('button', { name: 'Load selected note' }).click();
  await expect(page.locator('#content-editor')).toHaveValue(/Missing publish tag/);

  await page
    .locator('#candidate-rules-editor')
    .fill(JSON.stringify(createCandidateRulesDocument('Eligible/**'), null, 2));
  await page.getByRole('button', { name: 'Evaluate note' }).click();

  await expect(page.locator('#decision-summary')).toContainText('⛔ Ineligible');
  await expect(page.locator('#trace-output')).toContainText('⛔ publishTag');
  await expect(page.locator('#trace-output')).toContainText('✅ publishableArea');
  await expect(page.locator('#trace-output')).toContainText('✅ any');
});
