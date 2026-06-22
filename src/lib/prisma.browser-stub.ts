/**
 * Stub usado apenas no bundle do navegador (alias no vite.config).
 * Evita tela branca se algum módulo server-side for importado por engano no frontend.
 */
function serverOnly(): never {
  throw new Error(
    "Prisma não está disponível no navegador. Use API HTTP ou mova constantes/tipos para *Shared.ts / *Types.ts."
  );
}

export const prisma = new Proxy({} as object, {
  get() {
    return serverOnly;
  },
  apply() {
    return serverOnly();
  },
}) as never;
