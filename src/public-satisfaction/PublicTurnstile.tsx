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
import { TURNSTILE_COPY, type PublicTurnstileUiStatus } from "./publicTurnstileContract.js";
import {
  createTurnstileWidgetSlot,
  loadTurnstileApi,
  type TurnstileWidgetSlot,
} from "./turnstileLoader.js";

export type PublicTurnstileHandle = {
  reset: () => void;
};

export type PublicTurnstileStatus = PublicTurnstileUiStatus;

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
  const slotRef = useRef<TurnstileWidgetSlot | null>(null);
  if (!slotRef.current) slotRef.current = createTurnstileWidgetSlot();
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

  useImperativeHandle(ref, () => ({
    reset: () => {
      onTokenChangeRef.current(null);
      slotRef.current?.reset(typeof window !== "undefined" ? window.turnstile : undefined);
      setUi("ready", null);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    const slot = slotRef.current;
    if (!host || !siteKey || !slot) {
      setUi("error", TURNSTILE_COPY.error);
      return;
    }

    setUi("loading", null);
    onTokenChangeRef.current(null);

    void loadTurnstileApi()
      .then((api) => {
        if (cancelled || !hostRef.current) return;
        slot.mount(api, hostRef.current, {
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
            setUi("expired", TURNSTILE_COPY.expired);
          },
          "error-callback": () => {
            if (cancelled) return;
            onTokenChangeRef.current(null);
            setUi("error", TURNSTILE_COPY.error);
          },
        });
        if (!cancelled) setUi("ready", null);
      })
      .catch(() => {
        if (cancelled) return;
        onTokenChangeRef.current(null);
        setUi("error", TURNSTILE_COPY.error);
      });

    return () => {
      cancelled = true;
      slot.unmount(typeof window !== "undefined" ? window.turnstile : undefined);
    };
  }, [siteKey]);

  const statusLabel =
    status === "loading"
      ? TURNSTILE_COPY.loading
      : status === "expired" || status === "error"
        ? message
        : null;

  return (
    <section className="sat-turnstile" data-testid="satisfaction-turnstile" aria-live="polite">
      <h2 className="sat-turnstile-title">{TURNSTILE_COPY.title}</h2>
      <p className="sat-turnstile-help">{TURNSTILE_COPY.help}</p>
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
