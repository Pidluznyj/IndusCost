/**
 * Carrega o JavaScript oficial do Cloudflare Turnstile uma única vez.
 * Modo explícito: o React controla render / reset / remove.
 */

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const SCRIPT_LOAD_TIMEOUT_MS = 12_000;
const API_SETTLE_INTERVAL_MS = 50;
const API_SETTLE_ATTEMPTS = 20;

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

export type TurnstileScriptNode = {
  src: string;
  dataset: { turnstileLoaded?: string };
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  remove?: () => void;
};

export type TurnstileLoaderRuntime = {
  getApi: () => TurnstileApi | undefined;
  queryScript: (src: string) => TurnstileScriptNode | null;
  createAndInsertScript: (src: string) => TurnstileScriptNode;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

export type TurnstileLoader = {
  load: () => Promise<TurnstileApi>;
  reset: () => void;
};

export function createTurnstileLoader(runtime: TurnstileLoaderRuntime): TurnstileLoader {
  let inflight: Promise<TurnstileApi> | null = null;

  function waitForApi(attemptsLeft: number): Promise<TurnstileApi | null> {
    const api = runtime.getApi();
    if (api) return Promise.resolve(api);
    if (attemptsLeft <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      runtime.setTimeout(() => {
        void waitForApi(attemptsLeft - 1).then(resolve);
      }, API_SETTLE_INTERVAL_MS);
    });
  }

  function load(): Promise<TurnstileApi> {
    const existingApi = runtime.getApi();
    if (existingApi) return Promise.resolve(existingApi);
    if (inflight) return inflight;

    inflight = new Promise<TurnstileApi>((resolve, reject) => {
      const existing = runtime.queryScript(TURNSTILE_SCRIPT_SRC);
      const script = existing ?? runtime.createAndInsertScript(TURNSTILE_SCRIPT_SRC);

      const timeout = runtime.setTimeout(() => {
        cleanup();
        inflight = null;
        reject(new Error("timeout"));
      }, SCRIPT_LOAD_TIMEOUT_MS);

      const cleanup = () => {
        runtime.clearTimeout(timeout);
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      };

      const finishOk = (api: TurnstileApi) => {
        cleanup();
        script.dataset.turnstileLoaded = "1";
        resolve(api);
      };

      const fail = (reason: string) => {
        cleanup();
        inflight = null;
        try {
          script.remove?.();
        } catch {
          /* ignore */
        }
        reject(new Error(reason));
      };

      const onLoad = () => {
        void waitForApi(API_SETTLE_ATTEMPTS).then((api) => {
          if (api) {
            finishOk(api);
            return;
          }
          fail("api-missing");
        });
      };

      const onError = () => {
        fail("script-error");
      };

      if (runtime.getApi()) {
        finishOk(runtime.getApi() as TurnstileApi);
        return;
      }

      if (existing?.dataset.turnstileLoaded === "1") {
        void waitForApi(API_SETTLE_ATTEMPTS).then((api) => {
          if (api) {
            finishOk(api);
            return;
          }
          fail("api-missing");
        });
        return;
      }

      script.addEventListener("load", onLoad);
      script.addEventListener("error", onError);
    });

    return inflight;
  }

  return {
    load,
    reset() {
      inflight = null;
    },
  };
}

function createBrowserRuntime(): TurnstileLoaderRuntime {
  return {
    getApi: () => (typeof window === "undefined" ? undefined : window.turnstile),
    queryScript: (src) => {
      if (typeof document === "undefined") return null;
      return document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    },
    createAndInsertScript: (src) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
      return script;
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

let browserLoader: TurnstileLoader | null = null;

function getBrowserLoader(): TurnstileLoader {
  if (!browserLoader) {
    browserLoader = createTurnstileLoader(createBrowserRuntime());
  }
  return browserLoader;
}

export function loadTurnstileApi(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile só existe no browser"));
  }
  return getBrowserLoader().load();
}

export function resetTurnstileLoaderForTests(): void {
  getBrowserLoader().reset();
  browserLoader = null;
}

export type TurnstileWidgetSlot = {
  mount: (api: TurnstileApi, host: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (api: TurnstileApi | undefined) => void;
  unmount: (api: TurnstileApi | undefined) => void;
  widgetId: () => string | null;
  renderCount: () => number;
};

/** Um slot = no máximo um widget vivo. Remount (StrictMode) remove o anterior. */
export function createTurnstileWidgetSlot(): TurnstileWidgetSlot {
  let widgetId: string | null = null;
  let renders = 0;

  return {
    mount(api, host, options) {
      if (widgetId) {
        try {
          api.remove(widgetId);
        } catch {
          /* já removido */
        }
        widgetId = null;
      }
      widgetId = api.render(host, options);
      renders += 1;
      return widgetId;
    },
    reset(api) {
      if (!api || !widgetId) return;
      try {
        api.reset(widgetId);
      } catch {
        /* ignore */
      }
    },
    unmount(api) {
      const id = widgetId;
      widgetId = null;
      if (!api || !id) return;
      try {
        api.remove(id);
      } catch {
        /* ignore */
      }
    },
    widgetId: () => widgetId,
    renderCount: () => renders,
  };
}
