/**
 * Compatibilidade server-only.
 * Preferir imports explícitos:
 *   - `@/src/lib/auth/appAuth.shared.js` (puro / frontend-safe)
 *   - `@/src/lib/auth/appAuth.server.js` (crypto / Prisma / sessão)
 *
 * Este arquivo reexporta somente o módulo server — não usar no bundle do navegador.
 */
export * from "./auth/appAuth.server.js";
