import { test, expect } from '@playwright/test';

// Phone layout. Needs an index to browse; a synthetic one works:
//   node scripts/seed-synthetic.cjs /tmp/otso-demo
//   OTSO_DATA_DIR=/tmp/otso-demo npx playwright test --project=mobile
test.describe('Phone layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.row').first()).toBeVisible();
  });

  test('fits the screen without sideways scrolling', async ({ page }) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scrollWidth).toBe(clientWidth);
  });

  test('hides keyboard hints and the desktop sidebar', async ({ page }) => {
    await expect(page.locator('.footer')).toBeHidden();
    await expect(page.locator('aside')).toBeHidden();
  });

  test('shows two-line rows inside the viewport', async ({ page }) => {
    const row = page.locator('.row').first();
    const title = await row.locator('.col-title').boundingBox();
    const source = await row.locator('.col-source').boundingBox();
    const date = await row.locator('.col-date').boundingBox();
    const width = page.viewportSize()!.width;
    expect(source!.y).toBeGreaterThan(title!.y + title!.height - 1);
    expect(date!.x + date!.width).toBeLessThanOrEqual(width);
    expect(title!.x + title!.width).toBeLessThanOrEqual(date!.x);
  });

  test('keeps category chips on one row', async ({ page }) => {
    const tops = await page
      .locator('.filters .cat')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });

  test('filters by source from the sources sheet', async ({ page }) => {
    await page.locator('.sources-button').tap();
    const sheet = page.locator('aside');
    await expect(sheet).toBeVisible();

    await sheet.locator('label').first().tap();
    await expect(page.locator('.sources-button .badge')).toHaveText('1');

    await sheet.getByRole('button', { name: 'Done' }).tap();
    await expect(sheet).toBeHidden();

    await page.getByRole('button', { name: 'Clear filters' }).tap();
    await expect(page.locator('.sources-button .badge')).toHaveCount(0);
  });

  test('opens a result in a bottom sheet', async ({ page }) => {
    await page.locator('.row').first().tap();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.summary h2')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).tap();
    await expect(dialog).toBeHidden();
  });

  test('expands the timeline', async ({ page }) => {
    await page.locator('.timeline-container .header').tap();
    await expect(page.locator('.chart')).toBeVisible();
  });
});

test.describe('Coverage on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/coverage');
    await expect(page.locator('.lanes canvas').first()).toBeVisible();
  });

  test('fits the screen and keeps lanes full width', async ({ page }) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scrollWidth).toBe(clientWidth);
    const track = (await page.locator('.lane-track').first().boundingBox())!;
    expect(track.width).toBeGreaterThan(page.viewportSize()!.width - 40);
    const axis = (await page.locator('.axis-track').boundingBox())!;
    expect(Math.round(axis.x)).toBe(Math.round(track.x));
    expect(Math.round(axis.width)).toBe(Math.round(track.width));
  });

  test('a tap on a lane shows its count, not the lane details', async ({ page }) => {
    const track = (await page.locator('.lane-track').nth(2).boundingBox())!;
    await page.touchscreen.tap(track.x + track.width - 6, track.y + track.height / 2);
    await expect(page.getByRole('tooltip')).toBeVisible();
    await expect(page.locator('.details')).toHaveCount(0);
  });

  test('a tap on a lane name opens its gaps', async ({ page }) => {
    await page.locator('.lanes > .lane:not(.group) .lane-label').first().tap();
    await expect(page.locator('.details')).toHaveCount(1);
  });
});
