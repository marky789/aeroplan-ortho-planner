import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  plugins: [viteStaticCopy({ targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map(name => ({
      src: `node_modules/cesium/Build/Cesium/${name}`, dest: 'cesium', rename: { stripBase: 4 },
  })) })],
  build: { chunkSizeWarningLimit: 2000 },
});
