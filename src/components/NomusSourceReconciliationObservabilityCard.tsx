/**
 * SYNC-09 — Card de observabilidade (somente apresentação).
 * Regras de negócio / presença ficam no backend.
 */
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { AdminKpiSection, AdminMetricGrid } from "@/src/components/admin/adminUi";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatSyncCardDateTimeLine,
  formatSyncDurationMs,
  formatSyncIntOrDash,
} from "@/src/lib/nomusSyncCardFormat";
import { cn } from "@/src/lib/utils";

type EntityMetrics = {
  entityType: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  strategy: string | null;
  status: string | null;
  payloadComplete: boolean | null;
  pagesRead: number;
  rowsRead: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  missingCandidateCount: number;
  missingConfirmedCount: number;
  reactivatedCount: number;
  errors: number;
  http429Count: number;
  durationMs: number | null;
};

type AlertRow = {
  code: string;
  entityType: string;
  severity: "info" | "warning" | "critical";
  message: string;
  confirmsAbsence: false;
};

type StatusPayload = {
  metrics: { byEntity: EntityMetrics[]; source: string };
  alerts: AlertRow[];
  sensitiveFieldsExcluded: true;
  alertsConfirmAbsence: false;
};

type DrilldownItem = {
  entityType: string;
  externalId: string;
  code: string | null;
  sourcePresenceStatus: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  missingSince: string | null;
  sourceRemovedAt: string | null;
  lastSyncRunId: string | null;
  operationalImpact: {
    openBalance: number | null;
    isOperationallyPresent: boolean;
    adminAlert: boolean;
  };
};

type DrilldownPayload = {
  items: DrilldownItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function entityLabel(entityType: string): string {
  if (entityType === "SALES_ORDER") return "Pedidos";
  if (entityType === "ACCOUNTS_RECEIVABLE") return "Contas a Receber";
  if (entityType === "ACCOUNTS_PAYABLE") return "Contas a Pagar";
  return entityType;
}

function severityClass(severity: AlertRow["severity"]): string {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

export function NomusSourceReconciliationObservabilityCard() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("ALL");
  const [presenceFilter, setPresenceFilter] = useState("");
  const [codeFilter, setCodeFilter] = useState("");
  const [page, setPage] = useState(1);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<StatusPayload>(
        "/api/settings/nomus-sync/source-reconciliation-status"
      );
      setStatus(data?.metrics?.byEntity ? data : null);
      if (!data?.metrics?.byEntity) {
        setError("Resposta de observabilidade incompleta.");
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar a observabilidade de reconciliação."
      );
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrilldown = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        entityType: entityFilter,
        page: String(page),
        pageSize: "10",
      });
      if (presenceFilter.trim()) params.set("presenceStatus", presenceFilter.trim());
      if (codeFilter.trim()) params.set("code", codeFilter.trim());
      const data = await fetchJsonOk<DrilldownPayload>(
        `/api/settings/nomus-sync/source-reconciliation-records?${params}`
      );
      setDrilldown(data);
    } catch {
      setDrilldown(null);
    }
  }, [entityFilter, presenceFilter, codeFilter, page]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadDrilldown();
  }, [loadDrilldown]);

  return (
    <section
      className="nomus-sync-status-panel rounded-xl border border-border bg-card p-4 space-y-4"
      data-testid="nomus-source-reconciliation-observability"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-muted-foreground">
            Reconciliação de origem
          </p>
          <h3 className="text-base font-semibold">Observabilidade NomusSourceSyncRun</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Métricas oficiais de Pedidos, CR e CP. Alertas não confirmam ausências.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadStatus();
            void loadDrilldown();
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </div>
      )}

      {status?.alerts && status.alerts.length > 0 && (
        <div className="space-y-2">
          {status.alerts.map((alert, idx) => (
            <div
              key={`${alert.code}-${alert.entityType}-${idx}`}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm flex items-start gap-2",
                severityClass(alert.severity)
              )}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {(status?.metrics?.byEntity ?? []).map((entity) => (
          <AdminKpiSection
            key={entity.entityType}
            title={entityLabel(entity.entityType)}
            eyebrow={entity.strategy ?? "sem execução"}
          >
            <AdminMetricGrid>
              <MetricCard
                label="Status"
                value={entity.status ?? "—"}
                helperText={
                  entity.payloadComplete == null
                    ? undefined
                    : entity.payloadComplete
                      ? "payload completo"
                      : "payload incompleto"
                }
              />
              <MetricCard
                label="Última execução"
                value={formatSyncCardDateTimeLine(entity.lastFinishedAt ?? entity.lastStartedAt)}
                helperText={`Duração ${formatSyncDurationMs(entity.durationMs)}`}
              />
              <MetricCard label="Páginas" value={formatSyncIntOrDash(entity.pagesRead)} />
              <MetricCard label="Lidos" value={formatSyncIntOrDash(entity.rowsRead)} />
              <MetricCard label="Criados" value={formatSyncIntOrDash(entity.createdCount)} />
              <MetricCard label="Atualizados" value={formatSyncIntOrDash(entity.updatedCount)} />
              <MetricCard label="Inalterados" value={formatSyncIntOrDash(entity.unchangedCount)} />
              <MetricCard
                label="Candidatos"
                value={formatSyncIntOrDash(entity.missingCandidateCount)}
              />
              <MetricCard
                label="Confirmados"
                value={formatSyncIntOrDash(entity.missingConfirmedCount)}
              />
              <MetricCard
                label="Reativados"
                value={formatSyncIntOrDash(entity.reactivatedCount)}
              />
              <MetricCard label="Erros" value={formatSyncIntOrDash(entity.errors)} />
              <MetricCard label="HTTP 429" value={formatSyncIntOrDash(entity.http429Count)} />
            </AdminMetricGrid>
          </AdminKpiSection>
        ))}
      </div>

      <div className="rounded-xl border border-border p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">Entidade</span>
            <select
              className="block rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={entityFilter}
              onChange={(e) => {
                setPage(1);
                setEntityFilter(e.target.value);
              }}
            >
              <option value="ALL">Todas</option>
              <option value="SALES_ORDER">Pedidos</option>
              <option value="ACCOUNTS_RECEIVABLE">Contas a Receber</option>
              <option value="ACCOUNTS_PAYABLE">Contas a Pagar</option>
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">Presença</span>
            <select
              className="block rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={presenceFilter}
              onChange={(e) => {
                setPage(1);
                setPresenceFilter(e.target.value);
              }}
            >
              <option value="">Todas</option>
              <option value="PRESENT">PRESENT</option>
              <option value="MISSING_CANDIDATE">MISSING_CANDIDATE</option>
              <option value="MISSING_CONFIRMED">MISSING_CONFIRMED</option>
            </select>
          </label>
          <label className="text-xs space-y-1 grow">
            <span className="text-muted-foreground">Código / documento</span>
            <input
              className="block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={codeFilter}
              onChange={(e) => {
                setPage(1);
                setCodeFilter(e.target.value);
              }}
              placeholder="PD 02739 / documento"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-2">Entidade</th>
                <th className="py-2 pr-2">ExternalId</th>
                <th className="py-2 pr-2">Código</th>
                <th className="py-2 pr-2">Presença</th>
                <th className="py-2 pr-2">lastSeenAt</th>
                <th className="py-2 pr-2">Impacto</th>
              </tr>
            </thead>
            <tbody>
              {(drilldown?.items ?? []).map((row) => (
                <tr key={`${row.entityType}-${row.externalId}`} className="border-b border-border/60">
                  <td className="py-2 pr-2">{entityLabel(row.entityType)}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{row.externalId}</td>
                  <td className="py-2 pr-2">{row.code ?? "—"}</td>
                  <td className="py-2 pr-2">{row.sourcePresenceStatus}</td>
                  <td className="py-2 pr-2">
                    {formatSyncCardDateTimeLine(row.lastSeenAt)}
                  </td>
                  <td className="py-2 pr-2">
                    {row.operationalImpact?.adminAlert
                      ? "alerta candidato"
                      : row.operationalImpact?.isOperationallyPresent
                        ? "operacional"
                        : "fora da operação"}
                  </td>
                </tr>
              ))}
              {(drilldown?.items?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-muted-foreground">
                    Nenhum registro no filtro atual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {drilldown
              ? `${drilldown.total} registro(s) · página ${drilldown.page}/${drilldown.totalPages}`
              : "—"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-2 py-1 rounded border border-border disabled:opacity-40"
              disabled={(drilldown?.page ?? 1) <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded border border-border disabled:opacity-40"
              disabled={(drilldown?.page ?? 1) >= (drilldown?.totalPages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
