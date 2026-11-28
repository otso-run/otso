import { test, expect } from '@playwright/test';

// Coverage view. Needs an index; the synthetic one has gaps built in:
//   node scripts/seed-synthetic.cjs /tmp/otso-demo
//   OTSO_DATA_DIR=/tmp/otso-demo npx playwright test coverage
test.describe('Coverage view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/coverage');
    await expect(page.locator('.lanes canvas').first()).toBeVisible();
  });

  test('draws one lane per source on a shared axis', async ({ page }) => {
    const stats = await (await page.request.get('/api/coverage')).json();
    await expect(page.locator('.lanes > .lane')).toHaveCount(stats.sources.length);
    await expect(page.locator('.axis-track .tick').first()).toBeVisible();

    // Every lane's track starts and ends where the axis does
    const axis = await page.locator('.axis-track').boundingBox();
    for (const box of await page.locator('.lane-track').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().toJSON())
    )) {
      expect(Math.round(box.x)).toBe(Math.round(axis!.x));
      expect(Math.round(box.width)).toBe(Math.round(axis!.width));
    }
  });

  test('lists a source’s gaps and zooms to one', async ({ page }) => {
    const lane = page.locator('.lanes > .lane').filter({ has: page.locator('.lane-stats .gap-text') }).first();
    await lane.locator('.lane-label').click();
    const gap = lane.locator('.gap-list button').first();
    await expect(gap).toBeVisible();
    await gap.click();
    await expect(page.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset zoom' }).click();
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveClass(/active/);
  });

  test('drags across the lanes to zoom', async ({ page }) => {
    const track = (await page.locator('.lane-track').first().boundingBox())!;
    await page.mouse.move(track.x + track.width * 0.3, track.y + 8);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.6, track.y + 8, { steps: 4 });
    await expect(page.locator('.drag-box')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
  });

  test('shows the count under the pointer', async ({ page }) => {
    const track = (await page.locator('.lane-track').first().boundingBox())!;
    await page.mouse.move(track.x + track.width - 4, track.y + 8);
    await expect(page.getByRole('tooltip')).toBeVisible();
  });

  test('links a source to search', async ({ page }) => {
    const lane = page.locator('.lanes > .lane').first();
    await lane.locator('.lane-label').click();
    await lane.getByRole('link', { name: /Browse in search/ }).click();
    await expect(page).toHaveURL(/\/\?source=/);
    await expect(page.locator('.facets label.selected')).toHaveCount(1);
  });
});
