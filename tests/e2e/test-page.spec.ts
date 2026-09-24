import { expect, test } from '@playwright/test';
import {
  createCandidateRulesDocument,
  resetDefaultServerState,
} from './support/fixtures.ts';
import type { RuleNode, RulesDocumentV2 } from '../../src/rules/configTypes.js';

function createManyStepRulesDocument(stepCount: number): RulesDocumentV2 {
  const conditions: RuleNode[] = Array.from({ length: stepCount }, () => ({ rule: 'publishTag' }));
  return {
    rulesVersion: 2,
    rules: {
      definitions: {
        publishTag: {
          type: 'tag',
          allowList: ['publish'],
          requireAny: true,
          source: 'all',
        },
      },
      match: { all: conditions },
    },
  };
}

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

test('bounds trace output and result JSON with internal scrolling instead of growing the page', async ({ page }) => {
  await page.goto('/test.html');

  await page.getByLabel('Find vault note').fill('missing-tag');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('#file-select')).toContainText('Eligible/missing-tag.md');

  await page.locator('#file-select').selectOption('Eligible/missing-tag.md');
  await page.getByRole('button', { name: 'Load selected note' }).click();
  await expect(page.locator('#content-editor')).toHaveValue(/Missing publish tag/);

  await page
    .locator('#candidate-rules-editor')
    .fill(JSON.stringify(createManyStepRulesDocument(80), null, 2));
  await page.getByRole('button', { name: 'Evaluate note' }).click();

  await expect(page.locator('#decision-summary')).toContainText('⛔ Ineligible');

  const traceOutput = page.locator('#trace-output');
  const resultJson = page.locator('#result-json');

  await expect(traceOutput.locator('.trace-node')).toHaveCount(81);

  const traceMetrics = await traceOutput.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  const resultMetrics = await resultJson.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));

  expect(traceMetrics.overflowY).toBe('auto');
  expect(traceMetrics.scrollHeight).toBeGreaterThan(traceMetrics.clientHeight);

  expect(resultMetrics.overflowY).toBe('auto');
  expect(resultMetrics.scrollHeight).toBeGreaterThan(resultMetrics.clientHeight);
});
