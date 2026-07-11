import React, { useMemo, useState } from "react";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioIntelligenceSellerKpiDto } from "@/src/lib/financePortfolioReconciliationClient";
import { SELLER_KPI_EXPLANATIONS } from "@/src/lib/finance/portfolioIntelligenceSellerKpiExplanations";
import { cn } from "@/src/lib/utils";
import { financeModuleFilterFieldClass } from "@/src/lib/financeModuleUiStandards";
import { MetricHelpTooltip } from "./PortfolioIntelligenceHelpPopover";

type SortKey =
  | "risk"
  | "orderValue"
  | "averageConfidence"
  | "conversionCrValuePct";

type Props = {
  sellerKpis: PortfolioIntelligenceSellerKpiDto[];
  loading?: boolean;
  activeSellerKey?: string | null;
  onSelectSeller: (kpi: PortfolioIntelligenceSellerKpiDto) => void;
};

function HeaderCell({
  label,
  explainKey,
  className,
}: {
  label: string;
  explainKey: string;
  className?: string;
}) {
  const explanation = SELLER_KPI_EXPLANATIONS[explainKey] ?? null;
  return (
    <th className={cn("px-2 py-2 font-semibold", className)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <MetricHelpTooltip
          title={label}
          explanation={explanation}
          missingExplanation={!explanation}
        />
      </span>
    </th>
  );
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatFinancePercent(v);
}

/**
 * Qualidade da Carteira por Vendedor — consome sellerKpis da API (sem comissões).
 */
export function PortfolioIntelligenceSellerKpis({
  sellerKpis,
  loading = false,
  activeSellerKey = null,
  onSelectSeller,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("risk");

  const sorted = useMemo(() => {
    const copy = [...sellerKpis];
    copy.sort((a, b) => {
      if (sortKey === "risk") {
        const ar = a.orderValue > 0 ? a.blockedValue / a.orderValue : 0;
        const br = b.orderValue > 0 ? b.blockedValue / b.orderValue : 0;
        const c = br - ar || b.blockedValue - a.blockedValue;
        return c !== 0 ? c : b.orderValue - a.orderValue;
      }
      if (sortKey === "orderValue") return b.orderValue - a.orderValue;
      if (sortKey === "averageConfidence") {
        return b.averageConfidence - a.averageConfidence;
      }
      const ac = a.conversionCrValuePct ?? -1;
      const bc = b.conversionCrValuePct ?? -1;
      return bc - ac || b.orderValue - a.orderValue;
    });
    return copy;
  }, [sellerKpis, sortKey]);

  if (loading) {
    return (
      <div
        className="h-32 animate-pulse rounded-xl border border-border/60 bg-muted/40"
        data-testid="portfolio-intelligence-seller-kpis-loading"
      />
    );
  }

  return (
    <section
      className="space-y-2"
      data-testid="portfolio-intelligence-seller-kpis"
      aria-label="Qualidade da Carteira por Vendedor"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Qualidade da Carteira por Vendedor
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Vendedor do pedido (Nomus/SalesOrder). Não usa comissões nem responsável do CRM.
            Clique na linha para filtrar a tela.
          </p>
        </div>
        <div className="min-w-[180px]">
          <label className="text-[10px] font-bold uppercase text-muted-foreground">
            Ordenar por
          </label>
          <select
            className={financeModuleFilterFieldClass()}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            data-testid="portfolio-intelligence-seller-sort"
          >
            <option value="risk">Risco (vencido/bloqueado)</option>
            <option value="orderValue">Valor</option>
            <option value="averageConfidence">Confiança</option>
            <option value="conversionCrValuePct">Conversão em CR</option>
          </select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          Nenhum KPI de vendedor no filtro atual.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <p className="border-b border-border/50 px-2 py-1.5 text-[10px] text-muted-foreground md:hidden">
            Deslize horizontalmente para ver todas as colunas.
          </p>
          <table className="min-w-[980px] md:min-w-[1400px] w-full border-collapse text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <HeaderCell label="Vendedor" explainKey="sellerName" />
                <HeaderCell
                  label="Total pedidos"
                  explainKey="orderValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Qtd"
                  explainKey="ordersCount"
                  className="text-right"
                />
                <HeaderCell
                  label="Valor em CR"
                  explainKey="receivableValue"
                  className="text-right"
                />
                <HeaderCell
                  label="% CR valor"
                  explainKey="conversionCrValuePct"
                  className="text-right"
                />
                <HeaderCell
                  label="% CR qtd"
                  explainKey="conversionCrQtyPct"
                  className="text-right"
                />
                <HeaderCell
                  label="Valor c/ doc."
                  explainKey="documentConvertedValue"
                  className="text-right"
                />
                <HeaderCell
                  label="% doc. valor"
                  explainKey="conversionDocValuePct"
                  className="text-right"
                />
                <HeaderCell
                  label="Recebido"
                  explainKey="receivedValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Taxa receb."
                  explainKey="receiptRatePct"
                  className="text-right"
                />
                <HeaderCell
                  label="Sem NF/CR"
                  explainKey="stuckWithoutNfCrValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Vencido/bloq."
                  explainKey="blockedValue"
                  className="text-right"
                />
                <HeaderCell
                  label="% atend. op."
                  explainKey="operationalFulfillmentPct"
                  className="text-right"
                />
                <HeaderCell
                  label="Valor excedente"
                  explainKey="excessValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Prod. fora"
                  explainKey="ordersWithProductOutside"
                  className="text-right"
                />
                <HeaderCell
                  label="% baixa conf."
                  explainKey="lowConfidenceValuePct"
                  className="text-right"
                />
                <HeaderCell
                  label="Conf. média"
                  explainKey="averageConfidence"
                  className="text-right"
                />
                <HeaderCell label="Gargalo" explainKey="mainBottleneck" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const riskRatio =
                  row.orderValue > 0 ? row.blockedValue / row.orderValue : 0;
                const highRisk = riskRatio >= 0.25 || row.blockedValue > 0;
                const active = activeSellerKey === row.sellerKey;
                return (
                  <tr
                    key={row.sellerKey}
                    className={cn(
                      "border-t border-border/50 cursor-pointer transition-colors",
                      highRisk && "bg-rose-50/40",
                      active && "ring-2 ring-inset ring-sky-300/60 bg-sky-50/50",
                      !active && "hover:bg-sky-50/40"
                    )}
                    onClick={() => onSelectSeller(row)}
                    data-testid="portfolio-intelligence-seller-row"
                    data-seller-key={row.sellerKey}
                  >
                    <td className="px-2 py-2">
                      <div className="font-medium text-foreground">{row.sellerName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {row.sellerSource === "SALES_ORDER"
                          ? "Fonte: pedido (SalesOrder/Nomus)"
                          : "Fonte: não informada"}
                        {row.sellerExternalId != null
                          ? ` · ID ${row.sellerExternalId}`
                          : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.orderValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceInteger(row.ordersCount)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.receivableValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPct(row.conversionCrValuePct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPct(row.conversionCrQtyPct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.documentConvertedValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPct(row.conversionDocValuePct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.receivedValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPct(row.receiptRatePct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.stuckWithoutNfCrValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">
                      {formatFinanceCurrency(row.blockedValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPct(row.operationalFulfillmentPct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.excessValue ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceInteger(row.ordersWithProductOutside ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPct(row.lowConfidenceValuePct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.averageConfidence.toLocaleString("pt-BR", {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-medium">
                        {row.mainBottleneck}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
