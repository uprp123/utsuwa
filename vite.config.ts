import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const motionAutoloadDir = join(process.cwd(), 'static', 'motion-autoload');
mkdirSync(motionAutoloadDir, { recursive: true });
const motionAutoloadPlugin = () => ({
	name: 'utsuwa-motion-autoload',
	configureServer(server: { middlewares: { use: (path: string, handler: (_req: unknown, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }) => void) => void } }) {
		server.middlewares.use('/motion-autoload/index.json', (_req, res) => {
			const files = readdirSync(motionAutoloadDir)
				.filter((name) => name.toLowerCase().endsWith('.json') && name !== 'index.json')
				.sort((a, b) => a.localeCompare(b));
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
			res.end(JSON.stringify({ files }));
		});
	}
});

export default defineConfig({
	plugins: [motionAutoloadPlugin(), sveltekit(), tailwindcss()],
	define: {
		'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
		// True only when the frontend is built by the Tauri CLI (which sets
		// TAURI_ENV_PLATFORM). Baked in at build time so routing decisions never
		// depend on the Tauri globals being injected at runtime.
		__IS_DESKTOP__: JSON.stringify(!!process.env.TAURI_ENV_PLATFORM)
	},
	server: {
		// Motion backups can be several MB and may be momentarily locked while
		// copied on Windows. They are discovered through our endpoint at startup,
		// so Vite must not watch them as source files.
		watch: { ignored: ['**/static/motion-autoload/**'] }
	},
	ssr: {
		noExternal: ['bits-ui']
	}
});
