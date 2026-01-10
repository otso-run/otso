
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/document" | "/api/document/[id]" | "/api/search" | "/api/stats" | "/api/timeline";
		RouteParams(): {
			"/api/document/[id]": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string };
			"/api": { id?: string };
			"/api/document": { id?: string };
			"/api/document/[id]": { id: string };
			"/api/search": Record<string, never>;
			"/api/stats": Record<string, never>;
			"/api/timeline": Record<string, never>
		};
		Pathname(): "/" | "/api" | "/api/" | "/api/document" | "/api/document/" | `/api/document/${string}` & {} | `/api/document/${string}/` & {} | "/api/search" | "/api/search/" | "/api/stats" | "/api/stats/" | "/api/timeline" | "/api/timeline/";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/robots.txt" | string & {};
	}
}