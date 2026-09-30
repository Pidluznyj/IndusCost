/**
 * Guarda da sessão de borda (Cloudflare Access).
 *
 * Quando a sessão do Access expira, a borda responde qualquer `/api/*` com 302
 * para o login em outro domínio. O `fetch` não consegue seguir (CORS) e estoura
 * `TypeError: Failed to fetch` — indistinguível de queda de rede para a tela.
 *
 * Aqui o `fetch` global é embrulhado: numa falha de rede em chamada same-origin,
 * uma sonda GET com `redirect: "manual"` diz se a borda está redirecionando
 * (`opaqueredirect`). Se estiver, a página é recarregada — navegação de topo
 * segue o redirect, o usuário refaz o login do Access e volta para a mesma URL.
 *
 * Não altera respostas nem repete a chamada original (POST nunca é reenviado).
 */

export const EDGE_SESSION_PROBE_PATH = "/api/auth/me";
export const EDGE_SESSION_RELOAD_STORAGE_KEY = "induscost:edge-session-reload-at";
/** Janela anti-loop: no máximo um reload automático por intervalo. */
export const EDGE_SESSION_RELOAD_COOLDOWN_MS = 30_000;

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type EdgeSessionGuardDeps = {
  fetch: FetchFn;
  origin: string;
  /** Chamado quando a sonda confirma que a borda exige novo login. */
  onEdgeSessionExpired: () => void;
};

function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError"
  );
}

function isSameOriginRequest(input: RequestInfo | URL, origin: string): boolean {
  try {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, origin).origin === origin;
  } catch {
    return false;
  }
}

export function createEdgeSessionGuardFetch(deps: EdgeSessionGuardDeps): FetchFn {
  let probeInFlight: Promise<boolean> | null = null;

  const probeEdgeSessionExpired = (): Promise<boolean> => {
    probeInFlight ??= deps
      .fetch(EDGE_SESSION_PROBE_PATH, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "manual",
      })
      .then((res) => res.type === "opaqueredirect")
      // Sonda também falhou: é rede de verdade, não sessão de borda.
      .catch(() => false)
      .finally(() => {
        probeInFlight = null;
      });
    return probeInFlight;
  };

  return async (input, init) => {
    try {
      return await deps.fetch(input, init);
    } catch (e) {
      if (
        e instanceof TypeError &&
        !isAbortError(e) &&
        !init?.signal?.aborted &&
        isSameOriginRequest(input, deps.origin)
      ) {
        if (await probeEdgeSessionExpired()) deps.onEdgeSessionExpired();
      }
      throw e;
    }
  };
}

/** `true` se o reload pode acontecer agora (e registra o instante). */
export function claimEdgeSessionReload(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  nowMs: number
): boolean {
  if (!storage) return true;
  try {
    const last = Number(storage.getItem(EDGE_SESSION_RELOAD_STORAGE_KEY));
    if (Number.isFinite(last) && last > 0 && nowMs - last < EDGE_SESSION_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(EDGE_SESSION_RELOAD_STORAGE_KEY, String(nowMs));
  } catch {
    // sessionStorage indisponível: segue sem trava.
  }
  return true;
}

let installed = false;

export function installEdgeSessionGuard(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  let reloading = false;
  window.fetch = createEdgeSessionGuardFetch({
    fetch: window.fetch.bind(window),
    origin: window.location.origin,
    onEdgeSessionExpired: () => {
      if (reloading) return;
      let storage: Storage | null = null;
      try {
        storage = window.sessionStorage;
      } catch {
        storage = null;
      }
      if (!claimEdgeSessionReload(storage, Date.now())) return;
      reloading = true;
      window.location.reload();
    },
  });
}
