import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCoverage } from '$lib/search/coverage';

export const GET: RequestHandler = async () => {
  const start = performance.now();
  try {
    const data = getCoverage();
    const time = Math.round((performance.now() - start) * 100) / 100;
    console.log(`[coverage] ${data.sources.length} sources in ${time}ms`);
    return json({ ...data, time });
  } catch (err) {
    console.error('[coverage] failed', err);
    return json({ error: 'The search index could not be read.' }, { status: 503 });
  }
};
