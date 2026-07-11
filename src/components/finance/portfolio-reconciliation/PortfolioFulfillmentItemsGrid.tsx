import React from "react";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { TECHNICAL_ALERT_LABEL } from "@/src/lib/finance/portfolioOrderFulfillmentMap";

type ItemRow = NonNullable<
  import("@/src/lib/financePortfolioReconciliationClient").PortfolioIntelligenceOrderDetail["fulfillmentMap"]
>["orderItemsCoverage"][number];

function pctDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.min(100, Math.max(0, value)).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}%`;
}

function itemBadge(row: ItemRow): { label: string; className: string } | null {
  const attended = row.attendedQuantityCapped ?? row.attendedQuantity ?? 0;
  const excess = row.excessQuantityForThisProduct ?? 0;
  if (row.remainingQuantity <= 0.000001 && excess > 0.000001) {
    return {
      label: "Atendido com excedente",
      className: "border-[#FDBA74] bg-[#FFF6ED] text-[#C2410C]",
    };
  }
  if (attended <= 0.000001) {
    return {
      label: "Pendente",
      className: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
    };
  }
  if (row.remainingQuantity > 0.000001) {
    return {
      label: "Parcial",
      className: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
    };
  }
  return null;
}

export function PortfolioFulfillmentItemsGrid({
  rows,
}: {
  rows: ItemRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#EAECF0] bg-[#F9FAFB] px-3 py-4 text-center text-xs text-[#667085]">
        Sem itens do pedido na materialização.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="portfolio-fulfillment-items-grid">
      <table className="min-w-[980px] w-full border-collapse text-left text-xs">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
            <th className="py-2 pr-2">Produto</th>
            <th className="py-2 pr-2">Código externo</th>
            <th className="py-2 pr-2">Descrição</th>
            <th className="py-2 pr-2 text-right">Qtde pedida</th>
            <th className="py-2 pr-2 text-right">Qtde atendida</th>
            <th className="py-2 pr-2 text-right">Saldo</th>
            <th className="py-2 pr-2 text-right">Excedente</th>
            <th className="py-2 pr-2 text-right">% atendido</th>
            <th className="py-2 pr-2 text-right">Valor item</th>
            <th className="py-2 pr-2 text-right">Valor atendido</th>
            <th className="py-2 pr-2">Docs/NFs usadas</th>
            <th className="py-2">Alertas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const excess = row.excessQuantityForThisProduct ?? 0;
            const badge = itemBadge(row);
            const pct = Math.min(
              100,
              Math.max(0, row.fulfillmentPercentCapped ?? row.fulfillmentPercent ?? 0)
            );
            return (
              <tr
                key={
                  row.salesOrderItemId ??
                  String(row.externalProductId ?? row.productExternalId)
                }
                className="border-t border-[#EAECF0] align-top text-[14px] font-semibold text-[#344054]"
              >
                <td className="py-2 pr-2">
                  <div>{row.productCode ?? row.sku ?? "—"}</div>
                  {badge ? (
                    <span
                      className={`mt-1 inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-2 tabular-nums">
                  {row.externalProductId ?? row.productExternalId ?? "—"}
                </td>
                <td className="py-2 pr-2 text-[12px] font-normal text-[#667085]">
                  {row.description?.trim() || "—"}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFinanceInteger(row.orderedQuantity)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFinanceInteger(row.attendedQuantityCapped ?? row.attendedQuantity)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFinanceInteger(row.remainingQuantity)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-[#C2410C]">
                  {formatFinanceInteger(excess)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{pctDisplay(pct)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFinanceCurrency(row.orderItemValue)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFinanceCurrency(row.attendedValueByOrderPrice)}
                </td>
                <td className="py-2 pr-2 text-[11px] font-normal text-[#667085]">
                  {row.documentsUsed.length === 0
                    ? "—"
                    : row.documentsUsed
                        .map((d) => {
                          const nf =
                            d.nfeNumber ??
                            (d.nfeExternalId != null ? `NF ${d.nfeExternalId}` : null);
                          const doc =
                            d.stockDocumentExternalId != null
                              ? `Doc ${d.stockDocumentExternalId}`
                              : null;
                          return [nf, doc].filter(Boolean).join(" / ") || "—";
                        })
                        .join(", ")}
                </td>
                <td className="py-2 text-[11px] font-normal text-[#C2410C]">
                  {row.alerts.length
                    ? row.alerts.map((a) => TECHNICAL_ALERT_LABEL[a] ?? a).join(", ")
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
