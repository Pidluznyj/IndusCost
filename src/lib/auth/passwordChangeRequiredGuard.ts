/**
 * Enforcement REAL da troca obrigatória de senha (backend).
 *
 * O bloqueio não pode viver no React: DevTools, curl, Postman ou script
 * chamariam a API direto. Este guard roda no Express, antes das rotas de
 * negócio, e é FAIL CLOSED — com `mustChangePassword = true` tudo é negado,
 * exceto a whitelist explícita abaixo. Não é blacklist por módulo: módulo novo
 * nasce protegido sem ninguém lembrar de listá-lo.
 *
 * Superfícies NÃO humanas continuam intocadas. O guard só olha requisições que
 * carregam o cookie de sessão humana; sem esse cookie ele devolve o controle
 * imediatamente. Collector (identidade por peer Tailscale), Satisfação pública
 * (rotas registradas antes deste middleware), health e assets da SPA não são
 * afetados — e nada aqui passa a exigir `AppUser` onde antes não se exigia.
 */

import { APP_SESSION_COOKIE_NAME } from "./appAuth.shared.js";

export const PASSWORD_CHANGE_REQUIRED_CODE = "PASSWORD_CHANGE_REQUIRED";

/**
 * Superfície mínima liberada durante a troca obrigatória.
 *
 *  - `POST /api/auth/login`  — o usuário precisa poder autenticar com a
 *    credencial temporária; é o login que cria a sessão restrita.
 *  - `GET  /api/auth/me`     — o frontend descobre o estado sem adivinhar.
 *  - `POST /api/auth/complete-password-change` — a própria saída do estado.
 *  - `POST /api/auth/logout` — sair sempre precisa funcionar.
 *  - `GET  /api/health` e `GET /api/app-version` — liveness e versão do
 *    binário; não expõem dado de negócio e são consumidos por monitoração.
 *
 * Qualquer outra rota — inclusive `/api/auth/permissions-version` e
 * `/api/auth/sync-session-permissions` — responde 403.
 */
export const PASSWORD_CHANGE_ALLOWED_ROUTES: ReadonlyArray<{
  method: string;
  path: string;
}> = Object.freeze([
  { method: "POST", path: "/api/auth/login" },
  { method: "GET", path: "/api/auth/me" },
  { method: "POST", path: "/api/auth/logout" },
  { method: "POST", path: "/api/auth/complete-password-change" },
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/app-version" },
]);

/**
 * Normaliza como o roteador do Express compara: case-insensitive (o default
 * `case sensitive routing` está desligado) e tolerante a barra final (o
 * default `strict routing` também está desligado). Sem isso, `/api/auth/me/`
 * chegaria na rota certa mas seria negado pelo guard.
 */
export function normalizeGuardPath(rawPath: string): string {
  const withoutQuery = rawPath.split("?")[0] ?? "";
  const lowered = withoutQuery.toLowerCase();
  if (lowered.length > 1 && lowered.endsWith("/")) {
    return lowered.replace(/\/+$/, "") || "/";
  }
  return lowered;
}

const ALLOWED_KEYS = new Set(
  PASSWORD_CHANGE_ALLOWED_ROUTES.map((r) => `${r.method.toUpperCase()} ${normalizeGuardPath(r.path)}`)
);

/** Decisão pura — é o que os testes exercitam exaustivamente. */
export function isAllowedDuringPasswordChange(method: string, path: string): boolean {
  return ALLOWED_KEYS.has(`${String(method ?? "").toUpperCase()} ${normalizeGuardPath(path)}`);
}

export type PasswordChangeGuardDecision =
  | { action: "allow"; reason: "no-session-cookie" | "no-session" | "not-required" | "whitelisted" }
  | { action: "deny"; reason: "password-change-required" };

/**
 * Decisão a partir do estado já resolvido. Separada do middleware para poder
 * ser testada sem Express e sem banco.
 */
export function decidePasswordChangeGuard(input: {
  hasSessionCookie: boolean;
  mustChangePassword: boolean | null;
  method: string;
  path: string;
}): PasswordChangeGuardDecision {
  if (!input.hasSessionCookie) return { action: "allow", reason: "no-session-cookie" };
  if (input.mustChangePassword === null) return { action: "allow", reason: "no-session" };
  if (!input.mustChangePassword) return { action: "allow", reason: "not-required" };
  if (isAllowedDuringPasswordChange(input.method, input.path)) {
    return { action: "allow", reason: "whitelisted" };
  }
  return { action: "deny", reason: "password-change-required" };
}

/**
 * Detecção barata do cookie de sessão humana.
 *
 * Falso positivo só custa uma consulta de sessão (que o guard de rota faria de
 * qualquer forma, e cujo resultado fica em cache no `req.appAuth`). Falso
 * negativo é impossível: o nome do cookie aparece literalmente no header.
 */
export function requestHasAppSessionCookie(cookieHeader: string | undefined): boolean {
  return typeof cookieHeader === "string" && cookieHeader.includes(APP_SESSION_COOKIE_NAME);
}

type GuardRequest = {
  method: string;
  baseUrl?: string;
  path?: string;
  originalUrl?: string;
  headers: { cookie?: string | undefined };
};

type GuardResponse = {
  status: (code: number) => { json: (body: unknown) => unknown };
};

export type PasswordChangeGuardDeps = {
  /**
   * Resolve a sessão humana da requisição. Deve ser o MESMO leitor usado pelos
   * guards de rota (`readAppSession`), para não criar um segundo caminho de
   * autenticação nem uma consulta extra: o resultado é memoizado em `req.appAuth`.
   */
  resolveMustChangePassword: (req: GuardRequest) => Promise<boolean | null>;
  onError?: (error: unknown) => void;
};

/**
 * Middleware Express. Montar em `app.use("/api", ...)` ANTES das rotas de
 * negócio — o caminho comparado é `baseUrl + path`, ou seja, o caminho completo.
 */
export function createPasswordChangeRequiredGuard(deps: PasswordChangeGuardDeps) {
  return async function passwordChangeRequiredGuard(
    req: GuardRequest,
    res: GuardResponse,
    next: (err?: unknown) => void
  ): Promise<unknown> {
    const fullPath = `${req.baseUrl ?? ""}${req.path ?? ""}`;
    const hasSessionCookie = requestHasAppSessionCookie(req.headers?.cookie);

    if (!hasSessionCookie) return next();

    let mustChangePassword: boolean | null;
    try {
      mustChangePassword = await deps.resolveMustChangePassword(req);
    } catch (error) {
      // Fail closed: sem conseguir determinar o estado, a requisição NÃO segue
      // para a rota de negócio.
      deps.onError?.(error);
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message: "Erro ao verificar o estado da credencial.",
      });
    }

    const decision = decidePasswordChangeGuard({
      hasSessionCookie,
      mustChangePassword,
      method: req.method,
      path: fullPath,
    });

    if (decision.action === "allow") return next();

    return res.status(403).json({
      error: "FORBIDDEN",
      code: PASSWORD_CHANGE_REQUIRED_CODE,
      message: "Defina uma nova senha para continuar usando o sistema.",
    });
  };
}
