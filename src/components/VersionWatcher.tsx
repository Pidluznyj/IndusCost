import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  APP_VERSION_AUTO_RELOAD_MS,
  APP_VERSION_POLL_MS,
  type AppBuildInfo,
  isUserEditingForm,
  shouldReloadForNewAppVersion,
} from "@/src/lib/appVersionShared";
import { fetchJsonOk } from "@/src/lib/http";

const LOCAL_BUILD_INFO: AppBuildInfo =
  typeof __APP_BUILD_INFO__ !== "undefined"
    ? __APP_BUILD_INFO__
    : { commit: "unknown", buildTime: "", env: "development" };

export function VersionWatcher() {
  const [visible, setVisible] = useState(false);
  const [autoReloading, setAutoReloading] = useState(false);
  const reloadTimerRef = useRef<number | null>(null);

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current != null) return;
    setAutoReloading(true);
    reloadTimerRef.current = window.setTimeout(() => {
      window.location.reload();
    }, APP_VERSION_AUTO_RELOAD_MS);
  }, []);

  const reloadNow = useCallback(() => {
    if (reloadTimerRef.current != null) {
      window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    window.location.reload();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      try {
        const remote = await fetchJsonOk<AppBuildInfo>("/api/app-version");
        if (cancelled) return;

        const decision = shouldReloadForNewAppVersion(
          LOCAL_BUILD_INFO.commit,
          remote.commit,
          isUserEditingForm()
        );
        if (!decision.notify) return;

        setVisible(true);
        if (decision.autoReload) {
          scheduleReload();
        }
      } catch {
        // rede indisponível — tenta de novo no próximo intervalo
      }
    };

    const interval = window.setInterval(() => {
      void checkVersion();
    }, APP_VERSION_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (reloadTimerRef.current != null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [scheduleReload]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[9999] flex max-w-sm items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg"
      data-testid="app-version-update-banner"
    >
      <div className="flex-1 text-foreground">
        {autoReloading
          ? "Nova versão disponível. Atualizando…"
          : "Nova versão disponível."}
      </div>
      <button
        type="button"
        onClick={reloadNow}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
      >
        Atualizar agora
      </button>
    </div>
  );
}
