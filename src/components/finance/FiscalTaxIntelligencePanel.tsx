/**
 * UI — Inteligência tributária (Financeiro > Tributos).
 * Destacado ≠ apurado ≠ pago ≠ alocado; export XLSX; drill período→tributo→guia→NF→pedido.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FISCAL_TAX_INTEL_COLUMN_SOURCES,
  FISCAL_TAX_INTEL_GROUP_BY,
  FISCAL_TAX_INTEL_GROUP_BY_LABELS,
  type FiscalTaxIntelDrillLevel,
  type FiscalTaxIntelDrillNode,
  type FiscalTaxIntelGroupBy,
  type FiscalTaxIntelPayload,
} from "@/src/lib/finance/fiscalTaxIntelligenceClient";
import { canViewFiscalSettlements } from "@/src/lib/finance/fiscalSettlementPermissions";
import { cn } from "@/src/lib/utils";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return formatFinanceCurrency(n);
}

function defaultPeriod(): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

type Mode = "table" | "drill";

export function FiscalTaxIntelligencePanel(): JSX.Element {
  const auth = useAuth();
  const canView = canViewFiscalSettlements(auth);
  const defaults = defaultPeriod();
  const [mode, setMode] = useState<Mode>("table");
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [groupBy, setGroupBy] = useState<FiscalTaxIntelGroupBy>("taxType");
  const [taxType, setTaxType] = useState("");
  const [guideStatus, setGuideStatus] = useState("");
  const [payload, setPayload] = useState<FiscalTaxIntelPayload | null>(null);
  const [drillNodes, setDrillNodes] = useState<FiscalTaxIntelDrillNode[]>([]);
  const [drillPath, setDrillPath] = useState<
    Array<{ level: string; key: string; label: string }>
  >([]);
  const [drillLevel, setDrillLevel] = useState<FiscalTaxIntelDrillLevel>("period");
  const [drillCtx, setDrillCtx] = useState<{
    taxType?: string;
    guideId?: string;
    nfeExternalId?: number;
  }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryBase = useCallback(() => {
    const q = new URLSearchParams({
      periodStart,
      periodEnd,
      groupBy,
    });
    if (taxType.trim()) q.set("taxType", taxType.trim());
    if (guideStatus.trim()) q.set("guideStatus", guideStatus.trim());
    return q;
  }, [periodStart, periodEnd, groupBy, taxType, guideStatus]);

  const loadReport = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<FiscalTaxIntelPayload>(
        `/api/finance/fiscal-settlements/reports?${queryBase().toString()}`
      );
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar relatório.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [canView, queryBase]);

  const loadDrill = useCallback(
    async (
      level: FiscalTaxIntelDrillLevel,
      ctx: {
        taxType?: string;
        guideId?: string;
        nfeExternalId?: number;
      } = {}
    ) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({
          level,
          periodStart,
          periodEnd,
        });
        if (ctx.taxType) q.set("taxType", ctx.taxType);
        if (ctx.guideId) q.set("guideId", ctx.guideId);
        if (ctx.nfeExternalId != null) {
          q.set("nfeExternalId", String(ctx.nfeExternalId));
        }
        const data = await fetchJsonOk<{
          ok: true;
          drill: FiscalTaxIntelPayload["drill"];
        }>(`/api/finance/fiscal-settlements/reports/drill?${q.toString()}`);
        setDrillLevel(level);
        setDrillCtx(ctx);
        setDrillNodes(data.drill?.nodes ?? []);
        setDrillPath(data.drill?.path ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha no drilldown.");
      } finally {
        setLoading(false);
      }
    },
    [canView, periodStart, periodEnd]
  );

  useEffect(() => {
    if (mode === "table") void loadReport();
  }, [mode, loadReport]);

  useEffect(() => {
    if (mode === "drill") void loadDrill("period");
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps -- reset drill when entering mode

  const exportXlsx = () => {
    const url = `/api/finance/fiscal-settlements/reports/export.xlsx?${queryBase().toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!canView) {
    return (
      <div
        className="rounded-lg border border-[#E5E7EB] bg-white p-4 text-[13px] text-[#6B7280]"
        data-testid="fiscal-tax-intel-denied"
      >
        Sem permissão para inteligência tributária.
      </div>
    );
  }

  const kpis = payload?.kpis;

  return (
    <div className="space-y-4" data-testid="fiscal-tax-intel-panel">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12px]">
          <span className="mb-1 block font-semibold text-[#374151]">Início</span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12px]"
            data-testid="fiscal-tax-intel-period-start"
          />
        </label>
        <label className="text-[12px]">
          <span className="mb-1 block font-semibold text-[#374151]">Fim</span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12px]"
            data-testid="fiscal-tax-intel-period-end"
          />
        </label>
        <label className="text-[12px]">
          <span className="mb-1 block font-semibold text-[#374151]">Agrupar por</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as FiscalTaxIntelGroupBy)}
            className="rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12px]"
            data-testid="fiscal-tax-intel-groupby"
          >
            {FISCAL_TAX_INTEL_GROUP_BY.map((g) => (
              <option key={g} value={g}>
                {FISCAL_TAX_INTEL_GROUP_BY_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px]">
          <span className="mb-1 block font-semibold text-[#374151]">Tributo</span>
          <input
            value={taxType}
            onChange={(e) => setTaxType(e.target.value)}
            placeholder="ex.: IPI"
            className="w-24 rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12px]"
            data-testid="fiscal-tax-intel-tax-type"
          />
        </label>
        <label className="text-[12px]">
          <span className="mb-1 block font-semibold text-[#374151]">Status guia</span>
          <input
            value={guideStatus}
            onChange={(e) => setGuideStatus(e.target.value)}
            placeholder="PAID / OPEN…"
            className="w-28 rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12px]"
            data-testid="fiscal-tax-intel-guide-status"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-semibold",
              mode === "table"
                ? "bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
                : "text-[#4B5563] hover:bg-[#F3F4F6]"
            )}
            onClick={() => setMode("table")}
            data-testid="fiscal-tax-intel-mode-table"
          >
            Tabela
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-semibold",
              mode === "drill"
                ? "bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
                : "text-[#4B5563] hover:bg-[#F3F4F6]"
            )}
            onClick={() => setMode("drill")}
            data-testid="fiscal-tax-intel-mode-drill"
          >
            Drilldown
          </button>
          <button
            type="button"
            onClick={() =>
              mode === "table" ? void loadReport() : void loadDrill(drillLevel, drillCtx)
            }
            className="inline-flex items-center gap-1 rounded-md bg-[#1e3a8a] px-3 py-1.5 text-[12px] font-semibold text-white"
            data-testid="fiscal-tax-intel-refresh"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar
          </button>
          <button
            type="button"
            onClick={exportXlsx}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#111827]"
            data-testid="fiscal-tax-intel-export"
          >
            <Download className="h-3.5 w-3.5" />
            XLSX
          </button>
        </div>
      </div>

      {payload?.disclaimer ? (
        <p className="text-[11px] text-[#6B7280]" data-testid="fiscal-tax-intel-disclaimer">
          {payload.disclaimer}
        </p>
      ) : null}

      {error ? (
        <p className="text-[12px] text-red-600" data-testid="fiscal-tax-intel-error">
          {error}
        </p>
      ) : null}

      {kpis ? (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="fiscal-tax-intel-kpis"
        >
          {(
            [
              ["highlightedAmount", kpis.highlightedAmount],
              ["assessedAmount", kpis.assessedAmount],
              ["amountDue", kpis.amountDue],
              ["amountPaid", kpis.amountPaid],
              ["creditsAmount", kpis.creditsAmount],
              ["guideBalanceDue", kpis.guideBalanceDue],
              ["highlightedVsAssessed", kpis.highlightedVsAssessed],
              ["assessedVsPaid", kpis.assessedVsPaid],
            ] as const
          ).map(([key, value]) => {
            const meta = FISCAL_TAX_INTEL_COLUMN_SOURCES[key];
            return (
              <div
                key={key}
                className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  {meta.label}
                </p>
                <p className="text-[14px] font-bold text-[#111827]">{money(value)}</p>
                <p className="text-[10px] text-[#9CA3AF]">{meta.source}</p>
              </div>
            );
          })}
          <div className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Carga fiscal / receita
            </p>
            <p className="text-[14px] font-bold text-[#111827]">
              {kpis.fiscalLoadOnRevenue == null
                ? "—"
                : `${kpis.fiscalLoadOnRevenue.toFixed(2)}%`}
            </p>
            <p className="text-[10px] text-[#9CA3AF]">
              {FISCAL_TAX_INTEL_COLUMN_SOURCES.fiscalLoadOnRevenue.source}
            </p>
          </div>
        </div>
      ) : null}

      {mode === "table" ? (
        <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
          <table className="min-w-full text-left text-[12px]" data-testid="fiscal-tax-intel-table">
            <thead className="bg-[#F9FAFB] text-[10px] uppercase text-[#6B7280]">
              <tr>
                <th className="px-3 py-2">Grupo</th>
                <th className="px-3 py-2" title={FISCAL_TAX_INTEL_COLUMN_SOURCES.highlightedAmount.source}>
                  Destacado
                </th>
                <th className="px-3 py-2" title={FISCAL_TAX_INTEL_COLUMN_SOURCES.assessedAmount.source}>
                  Apurado
                </th>
                <th className="px-3 py-2" title={FISCAL_TAX_INTEL_COLUMN_SOURCES.amountDue.source}>
                  Devido
                </th>
                <th className="px-3 py-2" title={FISCAL_TAX_INTEL_COLUMN_SOURCES.amountPaid.source}>
                  Pago
                </th>
                <th className="px-3 py-2" title={FISCAL_TAX_INTEL_COLUMN_SOURCES.allocatedAmount.source}>
                  Alocado
                </th>
                <th className="px-3 py-2" title={FISCAL_TAX_INTEL_COLUMN_SOURCES.revenueBase.source}>
                  Receita
                </th>
                <th className="px-3 py-2">Carga %</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[#9CA3AF]">
                    {loading ? "Carregando…" : "Sem dados para o filtro."}
                  </td>
                </tr>
              ) : (
                (payload?.rows ?? []).map((r) => (
                  <tr key={r.groupKey} className="border-t border-[#F3F4F6]">
                    <td className="px-3 py-2 font-medium text-[#111827]">{r.groupLabel}</td>
                    <td className="px-3 py-2">{money(r.highlightedAmount)}</td>
                    <td className="px-3 py-2">{money(r.assessedAmount)}</td>
                    <td className="px-3 py-2">{money(r.amountDue)}</td>
                    <td className="px-3 py-2">{money(r.amountPaid)}</td>
                    <td className="px-3 py-2">{money(r.allocatedAmount)}</td>
                    <td className="px-3 py-2">{money(r.revenueBase)}</td>
                    <td className="px-3 py-2">
                      {r.fiscalLoadOnRevenue == null
                        ? "—"
                        : `${r.fiscalLoadOnRevenue.toFixed(2)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2" data-testid="fiscal-tax-intel-drill">
          <p className="text-[11px] text-[#6B7280]">
            Caminho:{" "}
            {drillPath.length
              ? drillPath.map((p) => p.label).join(" → ")
              : "Período → Tributo → Guia → NF → Pedido"}
          </p>
          <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
            <table className="min-w-full text-left text-[12px]">
              <thead className="bg-[#F9FAFB] text-[10px] uppercase text-[#6B7280]">
                <tr>
                  <th className="px-3 py-2">Nó</th>
                  <th className="px-3 py-2">Destacado</th>
                  <th className="px-3 py-2">Apurado</th>
                  <th className="px-3 py-2">Devido</th>
                  <th className="px-3 py-2">Pago</th>
                  <th className="px-3 py-2">Alocado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {drillNodes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-[#9CA3AF]">
                      {loading ? "Carregando…" : "Sem nós neste nível."}
                    </td>
                  </tr>
                ) : (
                  drillNodes.map((n) => (
                    <tr key={n.key} className="border-t border-[#F3F4F6]">
                      <td className="px-3 py-2 font-medium">{n.label}</td>
                      <td className="px-3 py-2">{money(n.metrics.highlightedAmount)}</td>
                      <td className="px-3 py-2">{money(n.metrics.assessedAmount)}</td>
                      <td className="px-3 py-2">{money(n.metrics.amountDue)}</td>
                      <td className="px-3 py-2">{money(n.metrics.amountPaid)}</td>
                      <td className="px-3 py-2">{money(n.metrics.allocatedAmount)}</td>
                      <td className="px-3 py-2 text-right">
                        {n.next ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-[#1e3a8a]"
                            onClick={() =>
                              void loadDrill(n.next!.level, {
                                taxType: n.next!.taxType,
                                guideId: n.next!.guideId,
                                nfeExternalId: n.next!.nfeExternalId,
                              })
                            }
                          >
                            Abrir →
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
