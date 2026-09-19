import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// GitHub project Pages runs under /<repository>/; local development uses /.
const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  define: { CESIUM_BASE_URL: JSON.stringify(`${base}cesium/`) },
  plugins: [viteStaticCopy({ targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map(name => ({
      src: `node_modules/cesium/Build/Cesium/${name}`, dest: 'cesium', rename: { stripBase: 4 },
  })) })],
  build: { chunkSizeWarningLimit: 2000 },
});
