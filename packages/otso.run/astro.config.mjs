// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import rehypeMermaid from 'rehype-mermaid';

// https://astro.build/config
export default defineConfig({
	markdown: {
		rehypePlugins: [rehypeMermaid],
	},
	integrations: [
		starlight({
			title: 'Otso',
			description: 'Welcome to Otso',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/otso-run/otso' }],
			sidebar: [
				{ label: 'Overview', autogenerate: { directory: 'overview' } },
				{ label: 'Tutorials', autogenerate: { directory: 'tutorials' } },
				{ label: 'How‑to Guides', autogenerate: { directory: 'how-to' } },
				{ label: 'Reference', autogenerate: { directory: 'reference' } },
				{ label: 'Explanations', autogenerate: { directory: 'explanations' } },
				{ label: 'Appendix', autogenerate: { directory: 'appendix' } },
			],
		}),
	],
});
