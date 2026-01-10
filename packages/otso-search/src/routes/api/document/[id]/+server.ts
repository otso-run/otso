import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSearchBackend } from '$lib/search';

export const GET: RequestHandler = async ({ params }) => {
  const id = parseInt(params.id);
  if (isNaN(id)) {
    throw error(400, 'Invalid document ID');
  }

  const backend = await getSearchBackend();
  const doc = await backend.getDocument(id);

  if (!doc) {
    throw error(404, 'Document not found');
  }

  return json(doc);
};
