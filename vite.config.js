import { defineConfig } from 'vite';

export default defineConfig(async ({ mode }) => {
  const plugins = [];
  if (mode === 'single') {
    const { viteSingleFile } = await import('vite-plugin-singlefile');
    plugins.push(viteSingleFile());
  }
  return {
    plugins,
    server: { host: true, proxy: { '/api': 'http://localhost:3000' } },
    preview: { proxy: { '/api': 'http://localhost:3000' } },
  };
});
