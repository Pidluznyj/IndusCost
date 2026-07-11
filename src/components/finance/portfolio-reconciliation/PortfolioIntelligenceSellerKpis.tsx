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
        className="h-32 animate-pulse rounded-xl border border-[#EAECF0] bg-[#F9FAFB]"
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
          <h3 className="text-sm font-semibold text-[#101828]">
            Qualidade da Carteira por Vendedor
          </h3>
          <p className="text-[11px] text-[#667085]">
            Vendedor comercial do pedido (Nomus/SalesOrder). Clique na linha para filtrar a
            tela.
          </p>
        </div>
        <div className="min-w-[180px]">
          <label className="text-[10px] font-bold uppercase text-[#667085]">
            Ordenar por
          </label>
          <select
            className={financeModuleFilterFieldClass()}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            data-testid="portfolio-intelligence-seller-sort"
          >
            <option value="risk">Maior valor em risco</option>
            <option value="orderValue">Maior valor de carteira</option>
            <option value="averageConfidence">Confiança</option>
            <option value="conversionCrValuePct">Conversão em CR</option>
          </select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#D0D5DD] bg-white px-3 py-6 text-center text-sm text-[#667085]">
          Nenhum KPI de vendedor no filtro atual.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EAECF0] bg-white">
          <p className="border-b border-[#EAECF0] px-2 py-1.5 text-[10px] text-[#667085] md:hidden">
            Deslize horizontalmente para ver todas as colunas.
          </p>
          <table className="min-w-[1200px] md:min-w-[1680px] w-full border-collapse text-left text-xs">
            <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wide text-[#667085]">
              <tr>
                <HeaderCell label="Vendedor" explainKey="sellerName" />
                <HeaderCell
                  label="Total pedidos"
                  explainKey="orderValue"
                  className="text-right"
                />
                <HeaderCell label="Qtd" explainKey="ordersCount" className="text-right" />
                <HeaderCell
                  label="Virou CR"
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
                  label="Virou doc."
                  explainKey="documentConvertedValue"
                  className="text-right"
                />
                <HeaderCell
                  label="% atend. op."
                  explainKey="operationalFulfillmentPct"
                  className="text-right"
                />
                <HeaderCell
                  label="Recebido"
                  explainKey="receivedValue"
                  className="text-right"
                />
                <HeaderCell
                  label="CR aberto"
                  explainKey="openReceivableValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Futuro"
                  explainKey="futureProbableValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Presente"
                  explainKey="presentAttentionValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Vencido/bloq."
                  explainKey="blockedValue"
                  className="text-right"
                />
                <HeaderCell
                  label="Venc. s/ doc."
                  explainKey="overdueWithoutDocumentCount"
                  className="text-right"
                />
                <HeaderCell
                  label="Parciais"
                  explainKey="partiallyAttendedCount"
                  className="text-right"
                />
                <HeaderCell
                  label="Excedente"
                  explainKey="ordersWithExcessCount"
                  className="text-right"
                />
                <HeaderCell
                  label="Prod. fora"
                  explainKey="ordersWithProductOutside"
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
                      "border-t border-[#EAECF0] cursor-pointer transition-colors bg-white",
                      highRisk && "border-l-[4px] border-l-[#FECDCA]",
                      !highRisk && "border-l-[4px] border-l-transparent",
                      active && "bg-[#F0F9FF]",
                      !active && "hover:bg-[#F9FAFB]"
                    )}
                    onClick={() => onSelectSeller(row)}
                    data-testid="portfolio-intelligence-seller-row"
                    data-seller-key={row.sellerKey}
                    data-bottleneck={row.mainBottleneckKey}
                  >
                    <td className="px-2 py-2">
                      <div className="font-medium text-[#101828]">{row.sellerName}</div>
                      <div className="text-[10px] text-[#667085]">
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
                      {formatPct(row.operationalFulfillmentPct)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.receivedValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.openReceivableValue ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.futureProbableValue ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.presentAttentionValue ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">
                      {formatFinanceCurrency(row.blockedValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceInteger(row.overdueWithoutDocumentCount ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceInteger(row.partiallyAttendedCount ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceInteger(row.ordersWithExcessCount ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceInteger(row.ordersWithProductOutside ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.averageConfidence.toLocaleString("pt-BR", {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          "inline-flex max-w-[11rem] rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                          row.mainBottleneckKey === "NONE"
                            ? "border-[#D0D5DD] bg-[#F9FAFB] text-[#667085]"
                            : "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                        )}
                        title={row.mainBottleneck}
                      >
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
