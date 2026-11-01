// 収集の拡張機能を collector/dist に作る（Chrome の「パッケージ化されていない拡張機能を読み込む」で dist を選ぶ）。
// 使い方: npm run build:collector
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'voiceTwinCollector',
      fileName: () => 'content.js',
    },
  },
});
