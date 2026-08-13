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

test("P21 AuthContext: poll permissions-version, sync-session e evento stale", () => {
  const ctx = read("src/contexts/AuthContext.tsx");
  const http = read("src/lib/http.ts");
  assert.match(ctx, /\/api\/auth\/permissions-version/);
  assert.match(ctx, /\/api\/auth\/sync-session-permissions/);
  assert.match(ctx, /APP_PERMISSIONS_STALE_EVENT/);
  assert.match(ctx, /await loadMe\(\)/);
  assert.match(http, /PERMISSIONS_VERSION_STALE/);
  assert.match(http, /notifyPermissionsStale/);
});

test("P21 server: epoch de sessão, endpoints de versão e readAppSession stale", () => {
  const server = read("server.ts");
  assert.match(server, /permissionsVersionAtIssue/);
  assert.match(server, /isSessionPermissionsVersionStale/);
  assert.match(server, /\/api\/auth\/permissions-version/);
  assert.match(server, /\/api\/auth\/sync-session-permissions/);
});

test("P21 schema: permissionsVersion em AppUser e AppSession", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /permissionsVersion\s+Int\s+@default\(0\)/);
  assert.match(schema, /permissionsVersionAtIssue\s+Int\s+@default\(0\)/);
});

test("RequireAuth: bloqueia enquanto carrega e redireciona ao /login sem sessão", () => {
  const src = read("src/components/RequireAuth.tsx");
  assert.match(src, /if\s*\(authLoading\)/);
  assert.match(src, /if\s*\(!authenticated\)/);
  assert.match(src, /to="\/login"/);
  assert.match(src, /from:\s*location/);
});

test("login: sessão expirada mostra formulário; só rede pura usa Tentar novamente", () => {
  const login = read("src/components/AuthLoginPage.tsx");
  const route = read("src/components/PublicLoginRoute.tsx");
  const ui = read("src/lib/authLoginUi.ts");
  assert.match(ui, /isAuthSessionExpiredMessage/);
  assert.match(ui, /isAuthConnectivityErrorMessage/);
  assert.match(login, /isAuthSessionExpiredMessage/);
  assert.match(login, /auth-login-session-banner/);
  assert.match(login, /Ir para o login/);
  assert.match(route, /authNotice=\{/);
  assert.doesNotMatch(login, /networkError && onRetry/);
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

test("admin auth: sessão principal, step-up e bootstrap são mecanismos distintos", () => {
  const app = read("src/App.tsx");
  const server = read("server.ts");
  const http = read("src/lib/http.ts");
  const login = read("src/components/AuthLoginPage.tsx");

  assert.match(app, /function AdminSettingsRoute/);
  assert.match(app, /canOpenAdminSettingsHub/);
  assert.match(app, /\/admin\/recovery/);
  assert.doesNotMatch(app, /Entrar no hub administrativo/);
  assert.doesNotMatch(app, /Acesso administrativo bootstrap temporário obrigatório/);

  const bootstrapLogin = server.slice(
    server.indexOf('app.post("/api/bootstrap-admin/login"'),
    server.indexOf('app.post("/api/bootstrap-admin/logout"')
  );
  assert.match(bootstrapLogin, /setBootstrapSessionCookie/);
  assert.doesNotMatch(bootstrapLogin, /setAppSessionCookie/);
  assert.doesNotMatch(bootstrapLogin, /clearAppSessionCookie/);
  assert.doesNotMatch(bootstrapLogin, /setAdminElevationCookie/);

  assert.match(server, /ADMIN_ELEVATION_COOKIE_NAME/);
  assert.match(server, /clearAdminElevationCookie\(res\)/);
  assert.match(server, /\/api\/auth\/admin-elevation\/confirm/);
  assert.match(http, /isNonSessionUnauthorizedCode/);
  assert.match(login, /\/admin\/recovery/);
});
