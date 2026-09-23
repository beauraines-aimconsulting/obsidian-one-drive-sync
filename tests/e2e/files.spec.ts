import { expect, test } from '@playwright/test';
import { resetDefaultServerState } from './support/fixtures.ts';

test.beforeEach(async () => {
  await resetDefaultServerState();
});

test('searches, paginates, shows badges, and previews file content', async ({ page }) => {
  await page.goto('/files.html');

  await expect(page.locator('#files-summary')).toContainText('1-100 of 106');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('#files-summary')).toContainText('101-106 of 106');

  await page.getByLabel('Search').fill('Eligible/');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('#files-list')).toContainText('Eligible/keep.md');
  await expect(page.locator('#files-list')).toContainText('Eligible/missing-tag.md');
  await expect(page.locator('#files-list')).toContainText('Eligible');
  await expect(page.locator('#files-list')).toContainText('Ineligible');

  await page.getByLabel('Search').fill('');
  await page.getByLabel('Eligibility').selectOption('parse-error');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('#files-list')).toContainText('Broken/bad.md');
  await expect(page.locator('#files-list')).toContainText('Parse error');

  await page.getByLabel('Eligibility').selectOption('');
  await page.getByLabel('Search').fill('keep');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.getByRole('button', { name: /Eligible\/keep\.md/ }).click();
  await expect(page.locator('#preview-path')).toContainText('Eligible/keep.md');
  await expect(page.locator('#preview-content')).toContainText('# Keep');
});
