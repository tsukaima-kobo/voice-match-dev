// サイトのビルド（GitHub Pages 用。どの住所の下に置いても動くよう base は './'）。
// ビルドした HTML には CSP を入れ、外への通信（fetch など）と外の物の読み込みを止める。
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "connect-src 'none'", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');

const csp = (): Plugin => ({
  name: 'voice-twin-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: './',
  plugins: [csp()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        about: fileURLToPath(new URL('./about.html', import.meta.url)),
        mimic: fileURLToPath(new URL('./mimic.html', import.meta.url)),
      },
    },
  },
});
