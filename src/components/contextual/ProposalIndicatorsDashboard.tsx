import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import type { Proposal } from "@/src/types/commercial";
import {
  proposalFinancialRollup,
  proposalStatusChartData,
  proposalStatusCounts,
} from "@/src/lib/proposalIndicatorsStats";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";
import { cn } from "@/src/lib/utils";

const STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ANALYSIS: "Em análise",
  SENT: "Enviada",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  EXPIRED: "Expirada",
  CANCELED: "Cancelada",
};

const BAR_TONE = ["bg-slate-700", "bg-slate-600", "bg-slate-500", "bg-slate-400", "bg-slate-300", "bg-slate-500", "bg-slate-400"];

export function ProposalIndicatorsDashboard() {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJsonOk("/api/proposals");
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar propostas.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => (rows ? proposalStatusCounts(rows) : null), [rows]);
  const chart = useMemo(() => (counts ? proposalStatusChartData(counts) : []), [counts]);
  const fin = useMemo(() => (rows ? proposalFinancialRollup(rows) : null), [rows]);

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Propostas — indicadores" backPath="/proposals">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows === null) {
    return (
      <ContextualDashboardLayout moduleLabel="Propostas — indicadores" backPath="/proposals">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows.length === 0) {
    return (
      <ContextualDashboardLayout moduleLabel="Propostas — indicadores" backPath="/proposals">
        <ContextualDashboardEmpty message="Não há propostas registradas. Os indicadores aparecerão quando houver dados." />
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Propostas — indicadores" backPath="/proposals">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Funil e valores</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Totais consolidados a partir dos campos gravados na proposta (totalNetValue, totalMarginPerc, etc.).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ContextualDashboardKpiCard label="Propostas" value={String(rows.length)} />
        <ContextualDashboardKpiCard label="Valor líquido total" value={formatCurrency(fin!.totalNet)} />
        <ContextualDashboardKpiCard label="Ticket médio (líquido)" value={formatCurrency(fin!.ticketMedio)} />
        <ContextualDashboardKpiCard
          label="Margem % média (registros com valor)"
          value={`${formatNumber(fin!.avgMarginPerc, 2)}%`}
        />
      </div>

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
    </ContextualDashboardLayout>
  );
}
