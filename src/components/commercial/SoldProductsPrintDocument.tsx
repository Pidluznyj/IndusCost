import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import {
  buildSoldProductsPrintFilterSummary,
  formatSoldProductsPrintDate,
  formatSoldProductsPrintDateTime,
  formatSoldProductsPrintLeader,
  formatSoldProductsPrintMoney,
  formatSoldProductsPrintPercent,
  formatSoldProductsPrintQty,
  SOLD_PRODUCTS_PRINT_FOOTER_NOTE,
  SOLD_PRODUCTS_PRINT_SUBTITLE,
  SOLD_PRODUCTS_PRINT_TITLE,
} from "@/src/lib/soldProductsPrintMeta.js";
import type { SoldProductsDashboardPayload } from "@/src/lib/salesProductRankingTypes.js";

export function SoldProductsPrintDocument({
  payload,
  branding,
  emitterName,
}: {
  payload: SoldProductsDashboardPayload;
  branding: BrandingSettingsDTO;
  emitterName?: string | null;
}) {
  const { filters, summary, ranking } = payload;
  const filterSummary = useMemo(() => buildSoldProductsPrintFilterSummary(filters), [filters]);

  const customerLabel =
    filters.customerName?.trim() ||
    filters.customerTaxId?.trim() ||
    (filters.customerId ? "Cliente selecionado" : "Todos");
  const productLabel =
    filters.productName?.trim() ||
    filters.productCode?.trim() ||
    (filters.productId ? "Produto selecionado" : "Todos");

  const metaLines = [
    { label: "Período", value: filters.periodLabel },
    { label: "Cliente", value: customerLabel },
    { label: "Produto", value: productLabel },
    { label: "Tipo de cliente", value: filters.customerScopeLabel },
    { label: "Top N", value: filters.topNLabel },
    { label: "Emitido em", value: formatSoldProductsPrintDateTime(payload.generatedAt) },
  ];
  if (emitterName?.trim()) {
    metaLines.push({ label: "Emitido por", value: emitterName.trim() });
  }

  return (
    <PrintDocumentShell
      rootId="sold-products-print-root"
      className="sold-products-print-document"
      footer={
        <>
          <p>
            {branding.companyName} · Documento gerado pelo IndusCost ·{" "}
            {formatSoldProductsPrintDateTime(payload.generatedAt)}
          </p>
          <p className="sold-products-print-footer-note">{SOLD_PRODUCTS_PRINT_FOOTER_NOTE}</p>
        </>
      }
    >
      <PrintHeader
        branding={branding}
        documentKind="Relatório gerencial"
        documentTitle="RELATÓRIO"
        documentHighlight="PRODUTOS VENDIDOS"
        metaLines={metaLines}
        subtitle={SOLD_PRODUCTS_PRINT_SUBTITLE}
        className="sold-products-print-doc-header"
      />

      <h1 className="sold-products-print-main-title">{SOLD_PRODUCTS_PRINT_TITLE}</h1>

      <table className="sold-products-print-meta-table">
        <tbody>
          <tr>
            <th>Tipo de data</th>
            <td>{filters.dateBasisLabel}</td>
            <th>Status pedido</th>
            <td>{filters.orderStatusLabel}</td>
          </tr>
          <tr>
            <th>Empresa</th>
            <td>{filters.companyLabel}</td>
            <th>Ordenação</th>
            <td>{filters.sortByLabel}</td>
          </tr>
          <tr>
            <th>Escopo</th>
            <td colSpan={3}>{filterSummary}</td>
          </tr>
        </tbody>
      </table>

      <PrintSection title="Resumo executivo" className="sold-products-print-section">
        <table className="sold-products-print-kpi-table">
          <tbody>
            <tr>
              <th>Quantidade total</th>
              <td>{formatSoldProductsPrintQty(summary?.totalQuantity)}</td>
              <th>Valor total</th>
              <td>{formatSoldProductsPrintMoney(summary?.totalAmount)}</td>
              <th>Produtos no ranking</th>
              <td>{summary?.productsCount ?? "—"}</td>
            </tr>
            <tr>
              <th>Pedidos</th>
              <td>{summary?.ordersCount ?? "—"}</td>
              <th>Clientes compradores</th>
              <td>{summary?.customersCount ?? "—"}</td>
              <th>Preço médio</th>
              <td>{formatSoldProductsPrintMoney(summary?.averageUnitPrice)}</td>
            </tr>
            <tr>
              <th>Líder em quantidade</th>
              <td colSpan={2}>{formatSoldProductsPrintLeader(summary?.topProductByQuantity ?? null)}</td>
              <th>Líder em valor</th>
              <td colSpan={2}>{formatSoldProductsPrintLeader(summary?.topProductByAmount ?? null)}</td>
            </tr>
          </tbody>
        </table>
      </PrintSection>

      <PrintSection
        title={`Ranking de produtos (${ranking.length} · ordenado por ${filters.sortByLabel.toLowerCase()})`}
        flow
        className="sold-products-print-section sold-products-print-ranking-section"
      >
        {ranking.length === 0 ? (
          <p className="sold-products-print-empty">Nenhum produto vendido no período selecionado.</p>
        ) : (
          <table className="sold-products-print-ranking-table">
            <colgroup>
              <col className="col-rank" />
              <col className="col-code" />
              <col className="col-product" />
              <col className="col-qty" />
              <col className="col-money" />
              <col className="col-money" />
              <col className="col-count" />
              <col className="col-count" />
              <col className="col-date" />
              <col className="col-pct" />
              <col className="col-pct" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Código</th>
                <th>Produto</th>
                <th className="col-num">Qtd.</th>
                <th className="col-money">Valor vendido</th>
                <th className="col-money">Preço médio</th>
                <th className="col-num">Pedidos</th>
                <th className="col-num">Clientes</th>
                <th className="col-date">Última venda</th>
                <th className="col-num">% qtd</th>
                <th className="col-num">% valor</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((row) => (
                <tr key={row.productId}>
                  <td className="col-num">{row.rank}</td>
                  <td className="col-code">{row.productCode ?? "—"}</td>
                  <td className="col-product">{row.productName}</td>
                  <td className="col-num col-nowrap">{formatSoldProductsPrintQty(row.quantitySold)}</td>
                  <td className="col-money col-nowrap">{formatSoldProductsPrintMoney(row.amountSold)}</td>
                  <td className="col-money col-nowrap">
                    {formatSoldProductsPrintMoney(row.averageUnitPrice)}
                  </td>
                  <td className="col-num">{row.ordersCount}</td>
                  <td className="col-num">{row.customersCount}</td>
                  <td className="col-date col-nowrap">
                    {formatSoldProductsPrintDate(row.lastSaleDate)}
                  </td>
                  <td className="col-num col-nowrap">
                    {formatSoldProductsPrintPercent(row.quantitySharePercent)}
                  </td>
                  <td className="col-num col-nowrap">
                    {formatSoldProductsPrintPercent(row.amountSharePercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PrintSection>
    </PrintDocumentShell>
  );
}
