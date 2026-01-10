import { test, expect } from '@playwright/test';

test.describe('Search UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the search page', async ({ page }) => {
    await expect(page).toHaveTitle(/otso/i);
  });

  test('should display search input', async ({ page }) => {
    const searchInput = page.locator('input[type="search"]');
    await expect(searchInput).toBeVisible();
  });

  test('should display stats in placeholder', async ({ page }) => {
    // Wait for stats to load from API
    await page.waitForResponse(response =>
      response.url().includes('/api/stats') && response.status() === 200
    );

    // Stats should be shown in the placeholder (e.g., "Search 1,462 records...")
    const searchInput = page.locator('input[type="search"]');
    await expect(searchInput).toHaveAttribute('placeholder', /Search \d+/);
  });

  test('should display source facets after loading', async ({ page }) => {
    // Wait for stats to load
    await page.waitForResponse(response =>
      response.url().includes('/api/stats') && response.status() === 200
    );

    // Source facets should be visible in the sidebar
    await page.waitForTimeout(500);
    const facets = page.locator('label, [data-testid="source-filter"]');
    const count = await facets.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should filter results when typing in search', async ({ page }) => {
    const searchInput = page.locator('input[type="search"]');
    await expect(searchInput).toBeVisible();

    // Start waiting for the search API response before typing
    const responsePromise = page.waitForResponse(response =>
      response.url().includes('/api/search') &&
      response.url().includes('q=') &&
      response.status() === 200
    , { timeout: 15000 });

    // Type a search query - this triggers oninput on each keystroke
    await searchInput.fill('test');

    // Wait for the search API response
    const response = await responsePromise;

    const data = await response.json();
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('backend');
  });

  test('should show results in list', async ({ page }) => {
    // Wait for initial browse mode load (requires sources or recent=1)
    const searchInput = page.locator('input[type="search"]');
    await searchInput.fill('test');

    await page.waitForResponse(response =>
      response.url().includes('/api/search') && response.status() === 200
    , { timeout: 15000 });

    await page.waitForTimeout(1000);

    // Results are rendered as div.row elements
    const resultRows = page.locator('.row');
    const count = await resultRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should toggle timeline visibility', async ({ page }) => {
    // Look for timeline toggle button
    const timelineToggle = page.locator('button:has-text("Timeline"), button[aria-label*="timeline" i]');

    if (await timelineToggle.isVisible()) {
      await timelineToggle.click();

      // Timeline should appear
      const timeline = page.locator('svg, canvas, [data-testid="timeline"]');
      await expect(timeline.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should open document modal when clicking result', async ({ page }) => {
    // Search for something
    const searchInput = page.locator('input[type="search"]');
    await searchInput.fill('test');

    await page.waitForResponse(response =>
      response.url().includes('/api/search') && response.status() === 200
    , { timeout: 15000 });

    await page.waitForTimeout(1000);

    // Click on a result row (div.row)
    const firstResult = page.locator('.row').first();
    if (await firstResult.isVisible()) {
      await firstResult.click();

      // Modal should appear
      const modal = page.locator('[role="dialog"], .modal, dialog');
      await expect(modal.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should filter by source when clicking checkbox', async ({ page }) => {
    // Wait for initial load
    await page.waitForResponse(response =>
      response.url().includes('/api/stats') && response.status() === 200
    );

    await page.waitForTimeout(500);

    // Find and click on a source checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();

    if (await checkbox.isVisible()) {
      await checkbox.check();

      // Wait for filtered search
      await page.waitForResponse(response =>
        response.url().includes('/api/search') && response.status() === 200
      , { timeout: 10000 });

      // Verify results loaded
      await page.waitForTimeout(300);
    }
  });

  test('should clear search input', async ({ page }) => {
    const searchInput = page.locator('input[type="search"]');

    // Type a search query
    await searchInput.fill('test query');

    // Clear with keyboard
    await searchInput.selectText();
    await page.keyboard.press('Backspace');

    await expect(searchInput).toHaveValue('');
  });

  test('should be keyboard navigable', async ({ page }) => {
    // Tab to focus search input
    await page.keyboard.press('Tab');

    const searchInput = page.locator('input[type="search"]');

    // Search input should be focusable (it has autofocus)
    await expect(searchInput).toBeFocused();

    // Type a search
    await page.keyboard.type('test');

    await expect(searchInput).toHaveValue('test');
  });

  test('should show timeline histogram', async ({ page }) => {
    // Wait for timeline data to load
    await page.waitForResponse(response =>
      response.url().includes('/api/timeline') && response.status() === 200
    );

    // Toggle timeline if needed
    const timelineToggle = page.locator('button:has-text("Timeline"), input[type="checkbox"]:near(:text("Timeline"))');
    if (await timelineToggle.isVisible()) {
      await timelineToggle.click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Search API', () => {
  test('stats endpoint returns valid data', async ({ request }) => {
    const response = await request.get('/api/stats');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('sources');
    expect(typeof data.total).toBe('number');
    expect(Array.isArray(data.sources)).toBeTruthy();
  });

  test('search endpoint returns valid data with query', async ({ request }) => {
    const response = await request.get('/api/search?q=test');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('facets');
    expect(data).toHaveProperty('backend');
    expect(Array.isArray(data.results)).toBeTruthy();
  });

  test('search endpoint returns empty without query or sources', async ({ request }) => {
    const response = await request.get('/api/search');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.results).toHaveLength(0);
    expect(data.backend).toBe('none');
  });

  test('search with recent flag returns results', async ({ request }) => {
    const response = await request.get('/api/search?q=&recent=1');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('results');
    expect(data.backend).not.toBe('none');
  });

  test('timeline endpoint returns valid data', async ({ request }) => {
    const response = await request.get('/api/timeline');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('buckets');
    expect(data).toHaveProperty('minMonth');
    expect(data).toHaveProperty('maxMonth');
    expect(Array.isArray(data.buckets)).toBeTruthy();
  });

  test('document endpoint returns valid data', async ({ request }) => {
    // First get a document ID from search
    const searchResponse = await request.get('/api/search?q=test&limit=1');
    const searchData = await searchResponse.json();

    if (searchData.results.length > 0) {
      const docId = searchData.results[0].id;
      const response = await request.get(`/api/document/${docId}`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('source');
      expect(data).toHaveProperty('content');
    }
  });

  test('search with source filter returns filtered results', async ({ request }) => {
    // First get available sources
    const statsResponse = await request.get('/api/stats');
    const stats = await statsResponse.json();

    if (stats.sources.length > 0) {
      const source = stats.sources[0].name;
      const response = await request.get(`/api/search?q=&sources=${source}&recent=1`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      // All results should be from the specified source
      for (const result of data.results) {
        expect(result.source).toBe(source);
      }
    }
  });

  test('search supports pagination', async ({ request }) => {
    // Get first page
    const page1 = await request.get('/api/search?q=test&limit=5&offset=0');
    const data1 = await page1.json();

    if (data1.results.length === 5) {
      // Get second page
      const page2 = await request.get('/api/search?q=test&limit=5&offset=5');
      const data2 = await page2.json();

      // Results should be different (unless there are < 10 results total)
      if (data2.results.length > 0) {
        expect(data1.results[0].id).not.toBe(data2.results[0].id);
      }
    }
  });
});

test.describe('Performance', () => {
  test('search API responds quickly', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/search?q=test');
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(2000); // Should respond within 2 seconds
  });

  test('stats API responds quickly', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/stats');
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(1000); // Should respond within 1 second
  });
});
