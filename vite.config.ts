import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      global: 'globalThis',
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      // NÃO adicione aliases-stub para Prisma aqui. A separação server/cliente é
      // garantida na arquitetura (ver scripts/checkFrontendServerImports.ts):
      // nenhum arquivo do bundle React pode importar Prisma direta ou
      // indiretamente. Mascarar com stub esconde vazamentos reais.
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: ['servidor-01.tail31eb9e.ts.net'],
    },
  };
});
