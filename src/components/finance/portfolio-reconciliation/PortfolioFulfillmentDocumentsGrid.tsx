import React from "react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { TECHNICAL_ALERT_LABEL } from "@/src/lib/finance/portfolioOrderFulfillmentMap";

type DocRow = NonNullable<
  import("@/src/lib/financePortfolioReconciliationClient").PortfolioIntelligenceOrderDetail["fulfillmentMap"]
>["stockDocumentsCoverage"][number];

export function PortfolioFulfillmentDocumentsGrid({
  rows,
}: {
  rows: DocRow[];
}) {
  if (rows.length === 0) {
    return (
      <p
        className="rounded-xl border border-dashed border-[#EAECF0] bg-[#F9FAFB] px-3 py-4 text-center text-xs text-[#667085]"
        data-testid="portfolio-fulfillment-documents-empty"
      >
        Nenhum documento de saída encontrado para este pedido.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="portfolio-fulfillment-documents-grid">
      <table className="min-w-[960px] w-full border-collapse text-left text-xs">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
            <th className="py-2 pr-2">NF</th>
            <th className="py-2 pr-2">Documento</th>
            <th className="py-2 pr-2">Data</th>
            <th className="py-2 pr-2 text-right">Valor cabeçalho</th>
            <th className="py-2 pr-2 text-right">Valor atribuído ao pedido</th>
            <th className="py-2 pr-2 text-right">Valor fora deste pedido</th>
            <th className="py-2 pr-2">Itens casados</th>
            <th className="py-2 pr-2">Itens fora</th>
            <th className="py-2 pr-2">Excedentes</th>
            <th className="py-2">Alertas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((doc) => {
            const outside = doc.itemsOutsideOrder ?? doc.unmatchedItems ?? [];
            return (
              <tr
                key={`${doc.nfeExternalId ?? ""}-${doc.stockDocumentExternalId ?? ""}`}
                className="border-t border-[#EAECF0] align-top text-[14px] font-semibold text-[#344054]"
              >
                <td className="py-2 pr-2">
                  {doc.nfeNumber ??
                    (doc.nfeExternalId != null ? String(doc.nfeExternalId) : "—")}
                </td>
                <td className="py-2 pr-2 tabular-nums">
                  {doc.stockDocumentExternalId != null
                    ? String(doc.stockDocumentExternalId)
                    : "—"}
                </td>
                <td className="py-2 pr-2 tabular-nums text-[12px] font-normal">
                  {formatFinanceDate(doc.date)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFinanceCurrency(doc.nfeHeaderValue)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFinanceCurrency(doc.valueAttributedToOrder)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-[#C2410C]">
                  {formatFinanceCurrency(doc.valueNotAttributedToOrder)}
                </td>
                <td className="py-2 pr-2 text-[11px] font-normal text-[#667085]">
                  {doc.matchedItems.length === 0
                    ? "—"
                    : doc.matchedItems
                        .map(
                          (m) =>
                            `${m.externalProductId ?? m.productExternalId ?? "?"} (${formatFinanceInteger(m.quantityUsedForOrder ?? m.allocatedQuantity)})`
                        )
                        .join(", ")}
                </td>
                <td className="py-2 pr-2 text-[11px] font-normal text-[#C2410C]">
                  {outside.length === 0
                    ? "—"
                    : outside
                        .map(
                          (x) =>
                            `${x.externalProductId ?? x.productExternalId ?? "?"} (${formatFinanceInteger(x.documentQuantity ?? x.stockQuantity)})`
                        )
                        .join(", ")}
                </td>
                <td className="py-2 pr-2 text-[11px] font-normal text-[#C2410C]">
                  {doc.surplusItems.length === 0
                    ? "—"
                    : doc.surplusItems
                        .map(
                          (x) =>
                            `${x.externalProductId ?? x.productExternalId ?? "?"} (${formatFinanceInteger(x.stockQuantity)})`
                        )
                        .join(", ")}
                </td>
                <td className="py-2 text-[11px] font-normal text-[#C2410C]">
                  {doc.alerts.length
                    ? doc.alerts.map((a) => TECHNICAL_ALERT_LABEL[a] ?? a).join(", ")
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
