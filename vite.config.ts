import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import { createAppBuildInfo } from './src/lib/appVersion.ts';

function writeBuildInfoPlugin(): Plugin {
  const buildInfo = createAppBuildInfo();
  return {
    name: 'induscost-write-build-info',
    config() {
      return {
        define: {
          __APP_BUILD_INFO__: JSON.stringify(buildInfo),
        },
      };
    },
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        path.join(outDir, 'build-info.json'),
        `${JSON.stringify(buildInfo, null, 2)}\n`,
        'utf8'
      );
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), writeBuildInfoPlugin()],
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
    build: {
      rollupOptions: {
        input: {
          // App administrativo.
          main: path.resolve(__dirname, 'index.html'),
          // Formulário público de Satisfação: entry SEPARADO de propósito.
          // Quem responde a pesquisa não deve baixar o bundle administrativo —
          // nem com as rotas apenas escondidas visualmente.
          satisfaction: path.resolve(__dirname, 'satisfacao.html'),
        },
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
