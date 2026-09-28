/**
 * Gate da Política Comercial, depois do gate de senha.
 * Fail closed para SELLER com versão vigente ainda não aceita.
 * Não lê X-Forwarded-For e não usa o userId enviado pelo browser.
 */
import { normalizeGuardPath } from "@/src/lib/auth/passwordChangeRequiredGuard.js";
import { POLICY_ACCEPTANCE_REQUIRED_CODE } from "./commercialPolicyRules.js";

const EXACT = new Set([
  "POST /api/auth/login",
  "GET /api/auth/me",
  "POST /api/auth/logout",
  "GET /api/health",
  "GET /api/app-version",
]);

export function isAllowedDuringPolicyAcceptance(method: string, path: string): boolean {
  const key = `${String(method ?? "").toUpperCase()} ${normalizeGuardPath(path)}`;
  if (EXACT.has(key)) return true;
  const normalized = normalizeGuardPath(path);
  const verb = String(method ?? "").toUpperCase();
  if (verb !== "GET" && verb !== "POST") return false;
  return normalized === "/api/commercial-policy" || normalized.startsWith("/api/commercial-policy/");
}

export function decidePolicyAcceptanceGuard(input: {
  hasSessionCookie: boolean;
  pending: boolean | null;
  method: string;
  path: string;
}): { action: "allow" | "deny" } {
  if (!input.hasSessionCookie) return { action: "allow" };
  if (input.pending === null) return { action: "allow" };
  if (!input.pending) return { action: "allow" };
  if (isAllowedDuringPolicyAcceptance(input.method, input.path)) return { action: "allow" };
  return { action: "deny" };
}

type GuardRequest = {
  method: string;
  baseUrl?: string;
  path?: string;
  headers: { cookie?: string | undefined };
};

type GuardResponse = {
  status: (code: number) => { json: (body: unknown) => unknown };
};

export function createCommercialPolicyAcceptanceGuard(deps: {
  resolvePending: (req: GuardRequest) => Promise<boolean | null>;
  hasSessionCookie: (cookieHeader: string | undefined) => boolean;
  onError?: (error: unknown) => void;
}) {
  return async function commercialPolicyAcceptanceGuard(
    req: GuardRequest,
    res: GuardResponse,
    next: (err?: unknown) => void
  ): Promise<unknown> {
    const fullPath = `${req.baseUrl ?? ""}${req.path ?? ""}`;
    if (!deps.hasSessionCookie(req.headers?.cookie)) return next();
    let pending: boolean | null;
    try {
      pending = await deps.resolvePending(req);
    } catch (error) {
      deps.onError?.(error);
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message: "Erro ao verificar o aceite da Política Comercial.",
      });
    }
    const decision = decidePolicyAcceptanceGuard({
      hasSessionCookie: true,
      pending,
      method: req.method,
      path: fullPath,
    });
    if (decision.action === "allow") return next();
    return res.status(403).json({
      error: "FORBIDDEN",
      code: POLICY_ACCEPTANCE_REQUIRED_CODE,
      message: "Aceite a Política Comercial vigente para continuar.",
    });
  };
}
