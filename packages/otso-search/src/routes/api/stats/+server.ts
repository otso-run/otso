import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSearchBackend } from '$lib/search';

export const GET: RequestHandler = async () => {
  console.log('[stats] request');
  const backend = await getSearchBackend();
  const stats = await backend.getStats();
  const response = { ...stats, backend: backend.name };
  console.log(`[stats] response: ${JSON.stringify(response).length} bytes`);
  return json(response);
};
