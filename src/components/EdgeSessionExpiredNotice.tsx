import React, { useCallback, useEffect, useRef, useState } from "react";
import { isUserEditingForm } from "@/src/lib/appVersionShared";
import {
  APP_EDGE_SESSION_EXPIRED_EVENT,
  EDGE_SESSION_AUTO_RELOAD_MS,
  isEdgeSessionExpired,
} from "@/src/lib/edgeSessionGuard";

/**
 * Aviso de sessão de borda (Cloudflare Access) expirada. Redireciona sozinho
 * para o novo login; se o usuário estiver digitando num formulário, espera o
 * clique para ele poder copiar o que ainda não salvou.
 */
export function EdgeSessionExpiredNotice() {
  const [visible, setVisible] = useState(false);
  const [autoReloading, setAutoReloading] = useState(false);
  const reloadTimerRef = useRef<number | null>(null);

  const reloadNow = useCallback(() => {
    if (reloadTimerRef.current != null) {
      window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    window.location.reload();
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      setVisible(true);
      if (isUserEditingForm() || reloadTimerRef.current != null) return;
      setAutoReloading(true);
      reloadTimerRef.current = window.setTimeout(() => {
        window.location.reload();
      }, EDGE_SESSION_AUTO_RELOAD_MS);
    };

    window.addEventListener(APP_EDGE_SESSION_EXPIRED_EVENT, handleExpired);
    if (isEdgeSessionExpired()) handleExpired();

    return () => {
      window.removeEventListener(APP_EDGE_SESSION_EXPIRED_EVENT, handleExpired);
      if (reloadTimerRef.current != null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
      data-testid="edge-session-expired-notice"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="edge-session-expired-title"
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 text-sm shadow-lg"
      >
        <h2
          id="edge-session-expired-title"
          className="text-base font-semibold text-foreground"
        >
          Sua sessão expirou
        </h2>
        <p className="mt-2 text-muted-foreground">
          {autoReloading
            ? "Redirecionando para um novo login…"
            : "Entre novamente para continuar. O que não foi salvo nesta tela será perdido — copie antes, se precisar."}
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={reloadNow}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            Entrar novamente
          </button>
        </div>
      </div>
    </div>
  );
}
