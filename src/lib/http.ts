/**
 * Wrapper central de HTTP do frontend.
 *
 * Regras (auth definitiva):
 *  - SEMPRE envia cookie de sessão: `credentials: "include"` por padrão.
 *  - Preserva `AbortSignal`, headers e body (inclui FormData — nunca força
 *    Content-Type).
 *  - 401 vira erro tipado `AuthRequiredError` e dispara o evento global
 *    `app-auth-required` (a menos que `suppressAuthEvent` seja passado), para o
 *    AuthContext limpar a sessão e redirecionar ao login — sem alert, sem loop.
 */

export const APP_AUTH_REQUIRED_EVENT = "app-auth-required";
export const APP_PERMISSIONS_STALE_EVENT = "app-permissions-stale";

export const PERMISSIONS_VERSION_STALE_CODE = "PERMISSIONS_VERSION_STALE";

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly existingSupplierId?: string;
  readonly conflicts?: Array<{
    field: string;
    formValue: string | null;
    personValue: string | null;
  }>;
  constructor(
    status: number,
    message: string,
    code?: string,
    existingSupplierId?: string,
    conflicts?: Array<{ field: string; formValue: string | null; personValue: string | null }>
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.existingSupplierId = existingSupplierId;
    this.conflicts = conflicts;
  }
}

/** Erro tipado para respostas 401 (sessão ausente/expirada). */
export class AuthRequiredError extends HttpError {
  constructor(message = "Sessão expirada. Faça login novamente.") {
    super(401, message, "UNAUTHORIZED");
    this.name = "AuthRequiredError";
  }
}

/** Erro tipado para ACL desatualizada na sessão (P21). */
export class PermissionsStaleError extends HttpError {
  constructor(message = "Permissões atualizadas. Recarregando sessão…") {
    super(403, message, PERMISSIONS_VERSION_STALE_CODE);
    this.name = "PermissionsStaleError";
  }
}

export type AppRequestInit = RequestInit & {
  /** Não disparar o evento global de auth em 401 (ex.: login, /api/auth/me). */
  suppressAuthEvent?: boolean;
};

export function notifyAuthRequired(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(APP_AUTH_REQUIRED_EVENT));
  }
}

export function notifyPermissionsStale(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(APP_PERMISSIONS_STALE_EVENT));
  }
}

export async function parseApiErrorPayload(res: Response): Promise<{
  message: string;
  code?: string;
  existingSupplierId?: string;
  conflicts?: Array<{ field: string; formValue: string | null; personValue: string | null }>;
}> {
  const fallback = `Erro HTTP ${res.status}`;
  try {
    const ct = res.headers.get("content-type");
    if (ct?.includes("application/json")) {
      const data: unknown = await res.json();
      if (data && typeof data === "object") {
        const o = data as Record<string, unknown>;
        const msg = typeof o.message === "string" ? o.message.trim() : "";
        const err = typeof o.error === "string" ? o.error.trim() : "";
        const code = typeof o.code === "string" ? o.code.trim() : undefined;
        const existingSupplierId =
          typeof o.existingSupplierId === "string" ? o.existingSupplierId : undefined;
        const conflicts = Array.isArray(o.conflicts)
          ? (o.conflicts as Array<{
              field: string;
              formValue: string | null;
              personValue: string | null;
            }>)
          : undefined;
        // Preferir message: o backend costuma enviar error=CHILD_COST_FAILED e o detalhe útil em message.
        const message = msg || err || (typeof o.details === "string" && o.details.trim()) || fallback;
        return { message, code, existingSupplierId, conflicts };
      }
      return { message: fallback };
    }
    const text = await res.text();
    return { message: text?.trim().slice(0, 300) || fallback };
  } catch {
    return { message: fallback };
  }
}

export async function parseApiErrorMessage(res: Response): Promise<string> {
  return (await parseApiErrorPayload(res)).message;
}

/** Normaliza init garantindo credentials e mantendo signal/headers/body intactos. */
function withCredentials(init: AppRequestInit): RequestInit {
  const { suppressAuthEvent: _suppress, ...rest } = init;
  return {
    ...rest,
    credentials: rest.credentials ?? "include",
  };
}

/** Lida com 401 de forma centralizada (evento global + erro tipado). */
async function raiseForUnauthorized(res: Response, init: AppRequestInit): Promise<never> {
  const message = (await parseApiErrorMessage(res)) || undefined;
  if (!init.suppressAuthEvent) notifyAuthRequired();
  throw new AuthRequiredError(message ?? undefined);
}

/** GET/POST etc. que retornam JSON no sucesso; lança erro tipado se !res.ok. */
export async function fetchJsonOk<T = unknown>(
  input: RequestInfo | URL,
  init: AppRequestInit = {}
): Promise<T> {
  const res = await fetch(input, withCredentials(init));
  if (res.status === 401) {
    await raiseForUnauthorized(res, init);
  }
  if (!res.ok) {
    const payload = await parseApiErrorPayload(res);
    if (
      res.status === 403 &&
      payload.code === PERMISSIONS_VERSION_STALE_CODE &&
      !init.suppressAuthEvent
    ) {
      notifyPermissionsStale();
      throw new PermissionsStaleError(payload.message);
    }
    throw new HttpError(
      res.status,
      payload.message,
      payload.code,
      payload.existingSupplierId,
      payload.conflicts
    );
  }
  const ct = res.headers.get("content-type");
  if (ct?.includes("application/json")) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

/** Resposta sem corpo JSON obrigatório (ex.: DELETE); lança erro tipado se !res.ok. */
export async function fetchOk(
  input: RequestInfo | URL,
  init: AppRequestInit = {}
): Promise<void> {
  const res = await fetch(input, withCredentials(init));
  if (res.status === 401) {
    await raiseForUnauthorized(res, init);
  }
  if (!res.ok) {
    const payload = await parseApiErrorPayload(res);
    throw new HttpError(
      res.status,
      payload.message,
      payload.code,
      payload.existingSupplierId,
      payload.conflicts
    );
  }
}
