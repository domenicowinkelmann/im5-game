import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(async ({ mode }) => {
  const plugins = [];
  const build = {};
  if (mode === 'single') {
    const { viteSingleFile } = await import('vite-plugin-singlefile');
    plugins.push(viteSingleFile());
  } else {
    build.rolldownOptions = {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    };
  }
  return {
    plugins,
    build,
    server: { host: true, proxy: { '/api': 'http://localhost:3000' } },
    preview: { proxy: { '/api': 'http://localhost:3000' } },
  };
});
