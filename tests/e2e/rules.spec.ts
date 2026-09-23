import * as fs from 'fs/promises';
import { expect, test } from '@playwright/test';
import {
  DEFAULT_RULES_PATH,
  createSavedRulesDocument,
  resetDefaultServerState,
} from './support/fixtures.ts';

test.beforeEach(async () => {
  await resetDefaultServerState();
});

test('edits rules with live validation, save protection, and etag conflict handling', async ({ page }) => {
  await page.goto('/rules.html');

  const saveButton = page.getByRole('button', { name: 'Save rules' });
  await expect(saveButton).toBeDisabled();

  await page.getByRole('button', { name: 'Add definition' }).click();
  await page.getByRole('tab', { name: 'Raw JSON' }).click();
  const rawEditor = page.locator('#raw-editor');
  const withEmptyPattern = (await rawEditor.inputValue()).replace(
    '"include": []',
    '"include": [""]'
  );
  await rawEditor.fill(withEmptyPattern);
  await expect(page.locator('#validation-output')).toContainText('Pattern must not be empty');
  await expect(saveButton).toBeDisabled();

  await rawEditor.fill(withEmptyPattern.replace('"include": [""]', '"include": ["Notes/**"]'));
  await expect(page.locator('#validation-output')).toContainText('Document is valid.');
  await page.waitForTimeout(400);
  await expect(saveButton).toBeEnabled();

  await saveButton.click();
  await expect(page.locator('#save-status')).toContainText('Rules saved and reloaded successfully.');
  await expect(page.locator('#diff-output')).toContainText('No pending changes.');

  const savedText = await fs.readFile(DEFAULT_RULES_PATH, 'utf-8');
  expect(savedText).toContain('Notes/**');

  const rawValue = await rawEditor.inputValue();
  expect(rawValue).toContain('Notes/**');

  await rawEditor.fill(`${rawValue}\n{`);
  await expect(page.locator('#validation-output')).toContainText('Invalid JSON');
  await expect(saveButton).toBeDisabled();

  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.locator('#validation-output')).toContainText('Document is valid.');

  const reloadedValue = await rawEditor.inputValue();
  const conflictedValue = reloadedValue.replace('Notes/**', 'Notes/**/*.md');
  await rawEditor.fill(conflictedValue);
  await page.waitForTimeout(400);
  await expect(saveButton).toBeEnabled();

  const externallyEditedDocument = createSavedRulesDocument();
  externallyEditedDocument.rules.definitions.publishableArea.include = ['Drafts/**'];
  await fs.writeFile(DEFAULT_RULES_PATH, `${JSON.stringify(externallyEditedDocument, null, 2)}\n`, 'utf-8');

  const conflictResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/rules') &&
      response.request().method() === 'PUT'
  );
  await saveButton.evaluate((button: HTMLButtonElement) => button.click());
  expect((await conflictResponsePromise).status()).toBe(409);
  await expect(page.locator('#save-status')).toContainText(
    'Save rejected because the on-disk rules changed. Reload and merge your edits.'
  );

  const conflictedText = await fs.readFile(DEFAULT_RULES_PATH, 'utf-8');
  expect(conflictedText).toContain('Drafts/**');
  expect(conflictedText).not.toContain('Notes/**/*.md');
});
