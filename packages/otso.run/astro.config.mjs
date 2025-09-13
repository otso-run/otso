// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import starlightDocSearch from '@astrojs/starlight-docsearch';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
	site: process.env.SITE_URL || 'https://www.otso.run',
	integrations: [
		// Mermaid must come BEFORE Starlight so markdown is prepared correctly
		mermaid({ autoTheme: true }),
		starlight({
			title: 'Otso',
			description: 'Local-first IndieWeb toolkit for archiving, syncing, harmonizing, and publishing your trails and streams.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/otso-run/otso' }],
			plugins: [
				// Enable Algolia DocSearch when env vars are present
				...(process.env.DOCSEARCH_APP_ID && process.env.DOCSEARCH_API_KEY && process.env.DOCSEARCH_INDEX_NAME
					? [
						starlightDocSearch({
							appId: process.env.DOCSEARCH_APP_ID,
							apiKey: process.env.DOCSEARCH_API_KEY,
							indexName: process.env.DOCSEARCH_INDEX_NAME,
						}),
					]
					: []),
			],
			sidebar: [
				{ label: 'Overview', autogenerate: { directory: 'overview' } },
				{ label: 'Tutorials', autogenerate: { directory: 'tutorials' } },
				{ label: 'How‑to Guides', autogenerate: { directory: 'how-to' } },
				{ label: 'Reference', autogenerate: { directory: 'reference' } },
				{ label: 'Explanations', autogenerate: { directory: 'explanations' } },
				{ label: 'Appendix', autogenerate: { directory: 'appendix' } },
			],
		}),
		sitemap(),
	],
});
