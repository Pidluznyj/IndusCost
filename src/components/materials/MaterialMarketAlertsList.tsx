import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Eye,
  Loader2,
} from "lucide-react";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type { MaterialMarketAlertApiItem } from "@/src/lib/materialMarketAlert";
import {
  MATERIALS_MARKET_INTELLIGENCE_ALERTS_API,
  getMaterialMarketIntelligenceAlertsApiPath,
} from "@/src/lib/materialsNavigation";
import { MaterialMarketIntelligenceExportButtons } from "@/src/components/materials/MaterialMarketIntelligenceExportButtons";

type AlertsApiResponse = {
  items: MaterialMarketAlertApiItem[];
  total: number;
  openCount: number;
};

function formatAlertDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function severityClasses(severity: MaterialMarketAlertApiItem["severity"]): string {
  switch (severity) {
    case "CRITICAL":
      return "border-red-200 bg-red-50 text-red-900";
    case "WARNING":
      return "border-amber-200 bg-amber-50 text-amber-950";
    default:
      return "border-sky-200 bg-sky-50 text-sky-950";
  }
}

type MaterialMarketAlertsListProps = {
  materialId?: string;
  compact?: boolean;
  onAlertsChange?: (openCount: number) => void;
};

export function MaterialMarketAlertsList({
  materialId,
  compact = false,
  onAlertsChange,
}: MaterialMarketAlertsListProps) {
  const [items, setItems] = useState<MaterialMarketAlertApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const apiPath = materialId
    ? getMaterialMarketIntelligenceAlertsApiPath(materialId)
    : MATERIALS_MARKET_INTELLIGENCE_ALERTS_API;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (!showResolved) params.set("status", "OPEN");
      const qs = params.toString();
      const url = qs ? `${apiPath}?${qs}` : apiPath;
      const data = await fetchJsonOk<AlertsApiResponse>(url);
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      onAlertsChange?.(data.openCount ?? nextItems.filter((i) => i.status === "OPEN").length);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar alertas.");
      setItems([]);
      onAlertsChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [apiPath, onAlertsChange, showResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatus = async (alertId: string, status: "READ" | "RESOLVED") => {
    setUpdatingId(alertId);
    try {
      await fetchOk(`/api/materials/market-intelligence/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar o alerta.");
    } finally {
      setUpdatingId(null);
    }
  };

  const visibleItems = useMemo(() => {
    if (showResolved) return items;
    return items.filter((item) => item.status === "OPEN" || item.status === "READ");
  }, [items, showResolved]);

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-10"
        data-testid="material-market-alerts-loading"
      >
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="mt-2 text-sm text-muted-foreground">Carregando alertas…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="material-market-alerts-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            data-testid="material-market-alerts-show-resolved"
          />
          Incluir resolvidos
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <MaterialMarketIntelligenceExportButtons
            scope="alerts"
            filters={{
              materialId: materialId ?? null,
              status: showResolved ? "ALL" : "OPEN",
            }}
          />
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-medium text-primary hover:underline"
          >
            Atualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      {visibleItems.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center"
          data-testid="material-market-alerts-empty"
        >
          <Bell className="mb-3 h-8 w-8 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            Nenhum alerta aberto no momento.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleItems.map((alert) => (
            <li
              key={alert.id}
              className={cn(
                "rounded-xl border px-4 py-3",
                severityClasses(alert.severity),
                compact && "text-sm"
              )}
              data-testid={`material-market-alert-${alert.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="font-semibold">{alert.title}</span>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {alert.alertTypeLabel}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide opacity-80">
                      {alert.severityLabel}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{alert.message}</p>
                  <p className="text-xs opacity-80">
                    {formatAlertDate(alert.triggeredAt)}
                    {alert.materialCode && !materialId ? (
                      <>
                        {" · "}
                        <Link
                          to={alert.intelligencePath}
                          className="font-medium underline underline-offset-2"
                        >
                          {alert.materialCode}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {alert.status === "OPEN" ? (
                    <button
                      type="button"
                      disabled={updatingId === alert.id}
                      onClick={() => void handleStatus(alert.id, "READ")}
                      className="inline-flex items-center gap-1 rounded-lg border border-current/20 bg-white/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/90 disabled:opacity-50"
                      data-testid={`material-market-alert-read-${alert.id}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Marcar como lido
                    </button>
                  ) : null}
                  {alert.status !== "RESOLVED" ? (
                    <button
                      type="button"
                      disabled={updatingId === alert.id}
                      onClick={() => void handleStatus(alert.id, "RESOLVED")}
                      className="inline-flex items-center gap-1 rounded-lg border border-current/20 bg-white/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/90 disabled:opacity-50"
                      data-testid={`material-market-alert-resolve-${alert.id}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Resolver
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MaterialsMarketIntelligenceAlertsPanel() {
  const [openCount, setOpenCount] = useState(0);

  return (
    <section
      className="space-y-3"
      aria-labelledby="materials-market-intelligence-alerts-heading"
      data-testid="materials-market-intelligence-alerts-section"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h4
            id="materials-market-intelligence-alerts-heading"
            className="text-sm font-semibold text-foreground"
          >
            Alertas de mercado
            {openCount > 0 ? (
              <span
                className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white"
                data-testid="materials-market-intelligence-alerts-badge"
              >
                {openCount}
              </span>
            ) : null}
          </h4>
          <p className="text-xs text-muted-foreground">
            Variações de preço, rupturas de histórico e cotações desatualizadas nas matérias
            monitoradas.
          </p>
        </div>
      </div>
      <MaterialMarketAlertsList onAlertsChange={setOpenCount} />
    </section>
  );
}

export function MaterialIntelligenceAlertsSection({ materialId }: { materialId: string }) {
  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      data-testid="material-intelligence-360-alerts-section"
    >
      <header className="mb-4 space-y-1">
        <h4 className="text-sm font-semibold text-foreground">Alertas de mercado</h4>
        <p className="text-xs text-muted-foreground">
          Sinais automáticos de variação de preço, histórico e oportunidades para esta matéria-prima.
        </p>
      </header>
      <MaterialMarketAlertsList materialId={materialId} />
    </section>
  );
}
