/**
 * Carrega o script oficial do Cloudflare Turnstile uma única vez.
 * Modo explícito: o React controla o lifecycle (render/reset/remove).
 */

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_SCRIPT_URL = TURNSTILE_SCRIPT_SRC;

const SCRIPT_LOAD_TIMEOUT_MS = 12_000;

export type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  appearance?: "always" | "execute" | "interaction-only";
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
};

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loadPromise: Promise<TurnstileApi> | null = null;

function resolveExistingApi(): TurnstileApi | null {
  return typeof window !== "undefined" && window.turnstile ? window.turnstile : null;
}

export function loadTurnstileApi(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile só existe no browser"));
  }
  const existingApi = resolveExistingApi();
  if (existingApi) return Promise.resolve(existingApi);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    );
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const timeout = window.setTimeout(() => {
      cleanup();
      loadPromise = null;
      reject(new Error("timeout"));
    }, SCRIPT_LOAD_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };

    const finishOk = () => {
      const api = resolveExistingApi();
      if (api) {
        cleanup();
        resolve(api);
        return true;
      }
      return false;
    };

    const onLoad = () => {
      if (finishOk()) return;
      cleanup();
      loadPromise = null;
      reject(new Error("api-missing"));
    };

    const onError = () => {
      cleanup();
      loadPromise = null;
      reject(new Error("script-error"));
    };

    if (existing && (script.dataset.turnstileLoaded === "1" || resolveExistingApi())) {
      if (finishOk()) return;
    }

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    script.addEventListener(
      "load",
      () => {
        script.dataset.turnstileLoaded = "1";
      },
      { once: true }
    );
  });

  return loadPromise;
}
