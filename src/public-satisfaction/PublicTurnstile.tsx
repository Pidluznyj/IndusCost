/**
 * Widget Cloudflare Turnstile da pesquisa pública.
 *
 * Render explícito, token só em memória (callback → estado React),
 * cleanup no unmount. Não persiste em storage/URL/cookie.
 */

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { loadTurnstileApi } from "./turnstileLoader.js";
import { turnstileUserMessage } from "./publicTurnstileContract.js";

export type PublicTurnstileHandle = {
  reset: () => void;
};

export type PublicTurnstileStatus = "loading" | "ready" | "verified" | "expired" | "error";

type Props = {
  siteKey: string;
  onTokenChange: (token: string | null) => void;
  onStatusChange?: (status: PublicTurnstileStatus) => void;
};

export const PublicTurnstile = forwardRef<PublicTurnstileHandle, Props>(function PublicTurnstile(
  { siteKey, onTokenChange, onStatusChange },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onStatusChangeRef = useRef(onStatusChange);
  const [status, setStatus] = useState<PublicTurnstileStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);

  onTokenChangeRef.current = onTokenChange;
  onStatusChangeRef.current = onStatusChange;

  const setUi = (next: PublicTurnstileStatus, text: string | null) => {
    setStatus(next);
    setMessage(text);
    onStatusChangeRef.current?.(next);
  };

  const resetWidget = () => {
    onTokenChangeRef.current(null);
    const api = window.turnstile;
    const id = widgetIdRef.current;
    if (api && id) {
      try {
        api.reset(id);
      } catch {
        /* widget já removido */
      }
    }
  };

  useImperativeHandle(ref, () => ({
    reset: () => {
      resetWidget();
      setUi("ready", null);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host || !siteKey) {
      setUi("error", turnstileUserMessage("error"));
      return;
    }

    setUi("loading", null);
    onTokenChangeRef.current(null);

    void loadTurnstileApi()
      .then((api) => {
        if (cancelled || !hostRef.current) return;
        if (widgetIdRef.current) {
          try {
            api.remove(widgetIdRef.current);
          } catch {
            /* ignore */
          }
          widgetIdRef.current = null;
        }
        const widgetId = api.render(hostRef.current, {
          sitekey: siteKey,
          appearance: "always",
          theme: "light",
          size: "flexible",
          callback: (token) => {
            if (cancelled) return;
            onTokenChangeRef.current(token);
            setUi("verified", null);
          },
          "expired-callback": () => {
            if (cancelled) return;
            onTokenChangeRef.current(null);
            setUi("expired", turnstileUserMessage("expired"));
          },
          "error-callback": () => {
            if (cancelled) return;
            onTokenChangeRef.current(null);
            setUi("error", turnstileUserMessage("error"));
          },
        });
        widgetIdRef.current = widgetId;
        setUi("ready", null);
      })
      .catch(() => {
        if (cancelled) return;
        onTokenChangeRef.current(null);
        setUi("error", turnstileUserMessage("error"));
      });

    return () => {
      cancelled = true;
      const api = window.turnstile;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (api && id) {
        try {
          api.remove(id);
        } catch {
          /* ignore */
        }
      }
    };
  }, [siteKey]);

  const statusLabel =
    status === "loading"
      ? "Carregando verificação de segurança…"
      : status === "verified"
        ? "Verificação concluída."
        : status === "expired" || status === "error"
          ? message
          : null;

  return (
    <section className="sat-turnstile" data-testid="satisfaction-turnstile" aria-live="polite">
      <h2 className="sat-turnstile-title">Verificação de segurança</h2>
      <p className="sat-turnstile-help">
        Para proteger esta pesquisa contra envios automatizados, conclua a
        verificação abaixo.
      </p>
      <div className="sat-turnstile-widget" ref={hostRef} />
      {statusLabel ? (
        <p
          className={
            status === "error" || status === "expired"
              ? "sat-turnstile-status is-error"
              : "sat-turnstile-status"
          }
          role={status === "error" || status === "expired" ? "alert" : "status"}
        >
          {statusLabel}
        </p>
      ) : null}
    </section>
  );
});
