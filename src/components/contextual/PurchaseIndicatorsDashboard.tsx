import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatNumber } from "@/src/lib/utils";
import type { PurchaseRequestRow, PurchaseRequestStatus } from "@/src/types/purchase";
import {
  purchaseStatusCounts,
  purchaseStatusChartData,
  topMaterialsByFrequency,
  totalPurchaseLines,
} from "@/src/lib/purchaseIndicatorsStats";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardKpiGrid } from "./ContextualDashboardKpiGrid";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";
import { cn } from "@/src/lib/utils";

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  ABERTA: "Aberta",
  REJEITADA: "Rejeitada",
  EM_COTACAO: "Em cotação",
  CANCELADA: "Cancelada",
  ENCERRADA: "Encerrada",
};

const BAR_TONE = [
  "bg-slate-700",
  "bg-amber-600",
  "bg-slate-500",
  "bg-orange-500",
  "bg-violet-600",
  "bg-slate-400",
  "bg-slate-300",
];

export function PurchaseIndicatorsDashboard() {
  const [rows, setRows] = useState<PurchaseRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJsonOk("/api/purchase-requests");
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar solicitações.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => (rows ? purchaseStatusCounts(rows) : null), [rows]);
  const chart = useMemo(() => (counts ? purchaseStatusChartData(counts) : []), [counts]);
  const lines = rows ? totalPurchaseLines(rows) : 0;
  const topMp = useMemo(() => (rows ? topMaterialsByFrequency(rows, 8) : []), [rows]);

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Compras — indicadores" backPath="/purchases">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows === null) {
    return (
      <ContextualDashboardLayout moduleLabel="Compras — indicadores" backPath="/purchases">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows.length === 0) {
    return (
      <ContextualDashboardLayout moduleLabel="Compras — indicadores" backPath="/purchases">
        <ContextualDashboardEmpty message="Não há solicitações de compra registradas. Os indicadores aparecerão quando houver dados." />
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Compras — indicadores" backPath="/purchases">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Panorama operacional</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Agregações sobre solicitações existentes (lista /api/purchase-requests). Não inclui pedidos ou recebimentos.
        </p>
      </div>

      <ContextualDashboardKpiGrid>
        <ContextualDashboardKpiCard label="Solicitações" value={String(rows.length)} />
        <ContextualDashboardKpiCard label="Linhas de itens (total)" value={String(lines)} />
        <ContextualDashboardKpiCard
          label="Abertas"
          value={String(counts!.ABERTA)}
          hint="Status ABERTA no cadastro atual."
        />
        <ContextualDashboardKpiCard label="Rascunhos" value={String(counts!.RASCUNHO)} />
      </ContextualDashboardKpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Distribuição por status</h4>
          <div className="space-y-3">
            {chart.map((row, i) => (
              <div key={row.key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{STATUS_LABEL[row.key]}</span>
                  <span className="font-semibold tabular-nums">
                    {row.value} ({formatNumber(row.pct, 1)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full print:bg-slate-600", BAR_TONE[i % BAR_TONE.length])}
                    style={{ width: `${Math.min(100, row.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Matérias-primas mais citadas (linhas)
          </h4>
          {topMp.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem linhas de MP nas solicitações atuais.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {topMp.map((m) => (
                <li key={m.code} className="flex justify-between gap-4 border-b border-border/60 pb-2 last:border-0">
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{m.code}</span>
                  <span className="text-right leading-snug">{m.description}</span>
                  <span className="font-semibold tabular-nums shrink-0">{m.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ContextualDashboardLayout>
  );
}
