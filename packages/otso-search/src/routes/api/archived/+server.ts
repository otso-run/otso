import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getArchived, setArchived } from '$lib/server/archived';

export const GET: RequestHandler = async () => json({ archived: await getArchived() });

// Body: { "source": "foursquare", "archived": true }
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const source = typeof body?.source === 'string' ? body.source.trim() : '';
  if (!source || source.length > 200 || typeof body?.archived !== 'boolean') {
    return json({ error: 'Expected { source: string, archived: boolean }' }, { status: 400 });
  }
  try {
    return json({ archived: await setArchived(source, body.archived) });
  } catch (err) {
    console.error('[archived] could not save', err);
    return json({ error: 'Could not save the archived list.' }, { status: 500 });
  }
};
