/**
 * Garantias de fiação (wiring) do fluxo de autenticação frontend/backend.
 * Mantém o contrato: credentials, 401 global, source-of-truth e cookie HTTP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("http.ts: credentials include por padrão e 401 tipado/global", () => {
  const src = read("src/lib/http.ts");
  assert.match(src, /credentials:\s*rest\.credentials\s*\?\?\s*"include"/);
  assert.match(src, /class AuthRequiredError/);
  assert.match(src, /APP_AUTH_REQUIRED_EVENT\s*=\s*"app-auth-required"/);
  assert.match(src, /notifyAuthRequired/);
});

test("AuthContext: source-of-truth, escuta 401 global e suprime evento em /me e login", () => {
  const src = read("src/contexts/AuthContext.tsx");
  assert.match(src, /addEventListener\(APP_AUTH_REQUIRED_EVENT/);
  assert.match(src, /removeEventListener\(APP_AUTH_REQUIRED_EVENT/);
  // /me e login não disparam o redirect global
  assert.match(src, /\/api\/auth\/me"[\s\S]*?suppressAuthEvent:\s*true/);
  assert.match(src, /\/api\/auth\/login"[\s\S]*?suppressAuthEvent:\s*true/);
  // não usa localStorage/sessionStorage como verdade de auth
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
});

test("RequireAuth: bloqueia enquanto carrega e redireciona ao /login sem sessão", () => {
  const src = read("src/components/RequireAuth.tsx");
  assert.match(src, /if\s*\(authLoading\)/);
  assert.match(src, /if\s*\(!authenticated\)/);
  assert.match(src, /to="\/login"/);
  assert.match(src, /from:\s*location/);
});

test("P11: Layout e RequirePathViewAccess usam DTO/navegação efetiva", () => {
  const layout = read("src/components/layout/Layout.tsx");
  assert.match(layout, /navigationAccessContextFromAuth/);
  assert.match(layout, /evaluatePathViewAccess/);
  assert.match(layout, /intendedPath/);

  const guard = read("src/components/RequirePathViewAccess.tsx");
  assert.match(guard, /evaluatePathViewAccess/);
  assert.match(guard, /AccessDenied/);

  const app = read("src/App.tsx");
  assert.match(app, /RequirePathViewAccess/);
});

test("DashboardModule usa fetchJsonOk (sem fetch cru) para dashboard", () => {
  const src = read("src/components/DashboardModule.tsx");
  assert.match(src, /fetchJsonOk<[^>]*>\(\s*[`"]\/api\/dashboard\/executive-summary/);
  assert.match(src, /fetchJsonOk<[^>]*>\(\s*"\/api\/dashboard"\)/);
  assert.doesNotMatch(src, /await fetch\(/);
});

test("Layout usa fetchJsonOk para logs Nomus", () => {
  const src = read("src/components/layout/Layout.tsx");
  assert.match(src, /fetchJsonOk<[^>]*>\(\s*\n?\s*"\/api\/settings\/nomus-sync\/logs/);
  assert.doesNotMatch(src, /await fetch\(/);
});

test("server.ts: cookie usa resolveCookieSecure e não secure por NODE_ENV", () => {
  const src = read("server.ts");
  assert.match(src, /resolveCookieSecure\(/);
  assert.match(src, /secure:\s*cookieSecureFor\(res\)/);
  // a regressão do bug (secure por produção em HTTP) não pode voltar
  assert.doesNotMatch(src, /secure:\s*process\.env\.NODE_ENV === "production"/);
});

test("server.ts: respostas /api com no-store (sem cache de auth)", () => {
  const src = read("server.ts");
  assert.match(src, /app\.use\("\/api",[\s\S]*?Cache-Control[\s\S]*?no-store/);
});

test("server.ts: rotas Nomus sync registradas", () => {
  const routes = read("src/lib/settingsNomusSyncRoutes.ts");
  const server = read("server.ts");
  assert.match(routes, /\/api\/integrations\/nomus\/health/);
  assert.match(routes, /\/api\/settings\/nomus-sync\/logs/);
  assert.match(routes, /\/api\/settings\/nomus-sync\/daily-status/);
  assert.match(routes, /\/api\/settings\/nomus-sync\/accounts-receivable-status/);
  assert.match(routes, /\/api\/settings\/nomus-sync\/accounts-payable-status/);
  assert.match(server, /registerSettingsNomusSyncRoutes/);
});
