import { defineConfig, type Plugin } from 'vite';

/** Rewrites `/assets/...` inside emitted `dist/assets/*.css` to `./...` so subpath hosts (GitHub Pages) resolve assets cleanly. */
function relativePublicCssUrls(): Plugin {
  return {
    name: 'relative-public-css-urls',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'asset' && item.fileName.endsWith('.css') && typeof item.source === 'string') {
          item.source = item.source
            .replace(/url\(\s*'\/assets\//g, "url('./")
            .replace(/url\(\s*"\/assets\//g, 'url("./')
            .replace(/url\(\s*\/assets\//g, 'url(./');
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [relativePublicCssUrls()],
  server: {
    host: '127.0.0.1',
    port: 8090,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js')) {
            return 'pixi';
          }
          if (
            id.includes('/src/ui/levelsCatalog.ts') ||
            id.includes('/src/ui/towerCatalog.ts') ||
            id.includes('/src/ui/travelCatalog.ts') ||
            id.includes('/src/save/plantUnlocks.ts')
          ) {
            return 'catalogs';
          }
        },
      },
    },
  },
});
