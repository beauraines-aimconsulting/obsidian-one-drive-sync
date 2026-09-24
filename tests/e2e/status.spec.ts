import { expect, test, type Page } from '@playwright/test';
import { resetDefaultServerState } from './support/fixtures.ts';

test.beforeEach(async () => {
  await resetDefaultServerState();
});

async function publishRulesUpdated(page: Page, count = 1): Promise<void> {
  await page.evaluate(async (updateCount) => {
    const getResponse = await fetch('/api/rules');
    const payload = await getResponse.json();
    let etag = getResponse.headers.get('etag');
    if (!getResponse.ok || !etag) {
      throw new Error(`Failed to load rules (${getResponse.status})`);
    }

    for (let index = 0; index < updateCount; index += 1) {
      const putResponse = await fetch('/api/rules', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': etag,
        },
        body: JSON.stringify(payload.document),
      });
      if (!putResponse.ok) {
        throw new Error(`Failed to save rules (${putResponse.status})`);
      }
      etag = putResponse.headers.get('etag') ?? etag;
    }
  }, count);
}

test('triggers a dry-run sync and streams live log updates over SSE', async ({ page }) => {
  await page.goto('/status.html');

  await expect(page.locator('#sync-enabled')).toContainText('Enabled');
  await expect(page.locator('#sync-dry-run')).toBeChecked();

  await page.getByRole('button', { name: 'Sync now' }).click();

  await expect(page.locator('#live-log-output')).toContainText('Scanning vault');
  await expect(page.locator('#live-log-output')).toContainText('Would upload: Eligible/keep.md');
  await expect(page.locator('#sync-status')).toContainText(
    'Dry run success: uploaded 1, skipped 0, removed 0, failed 0'
  );
});

test('keeps the live log in view beside the status actions on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 863 });
  await page.goto('/status.html');

  const layout = await page.evaluate(() => {
    const actionGrid = document.querySelector('.status-action-grid');
    const syncCard = actionGrid?.querySelector(':scope > .card');
    const authCard = actionGrid?.querySelector(':scope > .card:nth-child(2)');
    const liveLogCard = document.querySelector('.live-log-card');
    const liveLog = document.querySelector('#live-log-output');
    if (!actionGrid || !syncCard || !authCard || !liveLogCard || !liveLog) {
      throw new Error('Status layout elements are missing');
    }

    const actionGridRect = actionGrid.getBoundingClientRect();
    const syncRect = syncCard.getBoundingClientRect();
    const authRect = authCard.getBoundingClientRect();
    const liveLogCardRect = liveLogCard.getBoundingClientRect();
    const liveLogRect = liveLog.getBoundingClientRect();
    return {
      actionGridBottom: actionGridRect.bottom,
      syncRight: syncRect.right,
      authLeft: authRect.left,
      liveLogCardTop: liveLogCardRect.top,
      liveLogTop: liveLogRect.top,
      viewportHeight: window.innerHeight,
    };
  });

  expect(layout.syncRight).toBeLessThanOrEqual(layout.authLeft + 1);
  expect(layout.liveLogTop).toBeLessThan(layout.viewportHeight);
  expect(layout.actionGridBottom).toBeLessThan(layout.viewportHeight);
});

test('keeps the live log bounded and only follows output near the bottom', async ({ page }) => {
  await page.goto('/status.html');

  const liveLog = page.locator('#live-log-output');
  const initialHeight = await liveLog.evaluate((element) => element.clientHeight);

  await publishRulesUpdated(page, 40);
  await expect
    .poll(async () => {
      const text = await liveLog.textContent();
      return text?.match(/Rules updated and reloaded\./gu)?.length ?? 0;
    })
    .toBe(40);

  const completedMetrics = await liveLog.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      distanceFromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
      overflowY: styles.overflowY,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(completedMetrics.clientHeight).toBe(initialHeight);
  expect(completedMetrics.overflowY).toBe('auto');
  expect(completedMetrics.scrollHeight).toBeGreaterThan(completedMetrics.clientHeight);
  expect(completedMetrics.distanceFromBottom).toBeLessThanOrEqual(1);

  await liveLog.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 10;
  });
  await publishRulesUpdated(page);
  await expect
    .poll(async () => {
      const text = await liveLog.textContent();
      return text?.match(/Rules updated and reloaded\./gu)?.length ?? 0;
    })
    .toBe(41);
  await expect
    .poll(async () => {
      return liveLog.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      );
    })
    .toBeLessThanOrEqual(1);

  await liveLog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await publishRulesUpdated(page);
  await expect
    .poll(async () => {
      const text = await liveLog.textContent();
      return text?.match(/Rules updated and reloaded\./gu)?.length ?? 0;
    })
    .toBe(42);
  await expect
    .poll(async () => liveLog.evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(1);
});
