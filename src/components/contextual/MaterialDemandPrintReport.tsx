import React from "react";
import {
  buildFilterSummaryLines,
  dateBasisLabelPt,
  formatYmdAsPtBr,
  type FilterSummaryInput,
} from "@/src/components/contextual/materialDemandDashboardUi";
import type { MaterialDemandCoverage } from "@/src/lib/materialDemandFilters";
import { formatCurrencyAdaptive, formatNumberAdaptive } from "@/src/lib/utils";

export const MATERIAL_DEMAND_PRINT_ROWS_LIMIT = 100;
export const MATERIAL_DEMAND_PRINT_PERIOD_ROWS_LIMIT = 250;

export type MaterialDemandPrintRow = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string | null;
  unitLabel?: string;
  quantityTotal: number;
  unitCostReference: number | null;
  estimatedValueTotal: number;
  orderCount: number;
  productCount: number;
  customerCount?: number;
  leadingProduct?: { sku: string | null; name: string } | null;
  leadingCustomer?: { customerName: string } | null;
};

export type MaterialDemandPrintPeriodRow = {
  period: string;
  periodLabel: string;
  materialId: string;
  code: string | null;
  description: string;
  unitLabel: string;
  quantity: number;
  estimatedValue: number;
};

export type MaterialDemandPrintReportData = {
  context: "products" | "sales-orders";
  generatedAt: string;
  filterSummary: FilterSummaryInput;
  summary: {
    totalEstimatedQuantity: number | null;
    totalEstimatedValue: number;
    uniqueMaterials: number;
    orderCount: number;
    productCount: number;
    customerCount: number;
    quantityTotalsComparable: boolean;
  };
  coverage: MaterialDemandCoverage | null;
  rows: MaterialDemandPrintRow[];
  rowsTotalItems: number;
  rowsLimit: number;
  sortLabel: string;
  needByPeriod: MaterialDemandPrintPeriodRow[];
};

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrencyAdaptive(v);
}

function productLabel(sku: string | null | undefined, name: string | null | undefined): string {
  const n = name?.trim() || "—";
  return sku?.trim() ? `[${sku.trim()}] ${n}` : n;
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function renderMaterialRowGroup(row: MaterialDemandPrintRow) {
  const unit = row.unit ?? row.unitLabel ?? "—";
  const leadingProduct = row.leadingProduct
    ? productLabel(row.leadingProduct.sku, row.leadingProduct.name)
    : null;
  const leadingCustomer = row.leadingCustomer?.customerName?.trim() || null;
  const hasExtra = leadingProduct != null || leadingCustomer != null;

  return (
    <tbody key={row.materialId} className="md-print-material-item">
      <tr>
        <td className="md-print-cell-code">{row.code ?? "—"}</td>
        <td className="md-print-cell-description">{row.description}</td>
        <td className="md-print-cell-unit">{unit}</td>
        <td className="md-print-cell-qty md-print-num">{fmtNum(row.quantityTotal)}</td>
        <td className="md-print-cell-money md-print-num">{fmtMoney(row.estimatedValueTotal)}</td>
        <td className="md-print-cell-money md-print-num">{fmtMoney(row.unitCostReference)}</td>
        <td className="md-print-cell-count md-print-num">{row.orderCount}</td>
        <td className="md-print-cell-count md-print-num">{row.productCount}</td>
        <td className="md-print-cell-count md-print-num">{row.customerCount ?? "—"}</td>
      </tr>
      {hasExtra ? (
        <tr>
          <td colSpan={9} className="md-print-material-extra">
            {leadingProduct ? (
              <>
                <span className="md-print-material-extra-label">Principal produto:</span>
                {leadingProduct}
              </>
            ) : null}
            {leadingProduct && leadingCustomer ? (
              <span className="md-print-material-extra-sep" aria-hidden>
                |
              </span>
            ) : null}
            {leadingCustomer ? (
              <>
                <span className="md-print-material-extra-label">Principal cliente:</span>
                {leadingCustomer}
              </>
            ) : null}
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

export function MaterialDemandPrintReport({ data }: { data: MaterialDemandPrintReportData }) {
  const filterLines = buildFilterSummaryLines(data.filterSummary);
  const periodRows = data.needByPeriod.slice(0, MATERIAL_DEMAND_PRINT_PERIOD_ROWS_LIMIT);
  const periodTruncated = data.needByPeriod.length > periodRows.length;
  const rowsTruncated = data.rowsTotalItems > data.rows.length;

  const contextLine = [
    `Período: ${formatYmdAsPtBr(data.filterSummary.startDate)} a ${formatYmdAsPtBr(data.filterSummary.endDate)}`,
    `Base: ${dateBasisLabelPt(data.filterSummary.dateBasis)}`,
    ...filterLines.filter((l) => !l.startsWith("Base do período") && !l.startsWith("Período:")),
  ].join(" | ");

  return (
    <div className="material-demand-print-report">
      <section className="md-print-page-summary">
        <header className="md-print-header">
          <h1 className="md-print-title">Estimativa de uso de matéria-prima</h1>
          <p className="md-print-subtitle">Base: pedidos de venda</p>
          <p className="md-print-context">{contextLine}</p>
          <p className="md-print-disclaimer">
            Estimativa calculada com base nos pedidos de venda filtrados e na composição atual dos produtos. Não
            considera estoque disponível, compras em aberto ou consumo real de fábrica.
          </p>
        </header>

        <div className="md-print-section-summary">
          <h2 className="md-print-section-title">Resumo executivo</h2>
          <table className="md-print-kpi-table">
            <tbody>
              <tr>
                <th>Pedidos no filtro</th>
                <td>{fmtNum(data.coverage?.ordersMatched ?? data.summary.orderCount)}</td>
                <th>Itens processados</th>
                <td>{fmtNum(data.coverage?.orderItemsProcessed)}</td>
                <th>MPs únicas</th>
                <td>{fmtNum(data.summary.uniqueMaterials)}</td>
                <th>Valor estimado total</th>
                <td>{fmtMoney(data.summary.totalEstimatedValue)}</td>
              </tr>
              <tr>
                <th>Pedidos considerados</th>
                <td>{fmtNum(data.summary.orderCount)}</td>
                <th>Produtos impactados</th>
                <td>{fmtNum(data.summary.productCount)}</td>
                <th>Clientes impactados</th>
                <td>{fmtNum(data.summary.customerCount)}</td>
                <th>Qtd. estimada total</th>
                <td>
                  {data.summary.quantityTotalsComparable
                    ? fmtNum(data.summary.totalEstimatedQuantity)
                    : "Várias unidades"}
                </td>
              </tr>
            </tbody>
          </table>
          {data.coverage &&
          (data.coverage.orderItemsSkippedInvalidQty > 0 ||
            data.coverage.orderItemsSkippedAnalysisFailure > 0 ||
            data.coverage.orderItemsSkippedExplosionError > 0 ||
            data.coverage.orderItemsSkippedNoMaterials > 0) ? (
            <p className="md-print-note">
              Itens ignorados: inválidos {data.coverage.orderItemsSkippedInvalidQty}, análise{" "}
              {data.coverage.orderItemsSkippedAnalysisFailure}, explosão{" "}
              {data.coverage.orderItemsSkippedExplosionError}, sem MP{" "}
              {data.coverage.orderItemsSkippedNoMaterials}.
            </p>
          ) : null}
        </div>
      </section>

      <section className="md-print-page-detail">
        <h2 className="md-print-section-title">Matérias-primas — estimativa de uso</h2>
        <p className="md-print-note">
          Ordenação: {data.sortLabel} (decrescente).
          {rowsTruncated
            ? ` Relatório impresso com as primeiras ${data.rows.length} de ${data.rowsTotalItems} matérias-primas conforme ordenação atual.`
            : ` Total: ${data.rowsTotalItems} matérias-primas.`}
        </p>
        <table className="md-print-materials-table">
          <thead>
            <tr>
              <th className="md-print-cell-code">Código</th>
              <th className="md-print-cell-description">Descrição</th>
              <th className="md-print-cell-unit">Un.</th>
              <th className="md-print-cell-qty md-print-num">Qtd. est.</th>
              <th className="md-print-cell-money md-print-num">Valor est.</th>
              <th className="md-print-cell-money md-print-num">Custo unit.</th>
              <th className="md-print-cell-count md-print-num">Ped.</th>
              <th className="md-print-cell-count md-print-num">Prod.</th>
              <th className="md-print-cell-count md-print-num">Cli.</th>
            </tr>
          </thead>
          {data.rows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={9}>Nenhuma matéria-prima para os filtros selecionados.</td>
              </tr>
            </tbody>
          ) : (
            data.rows.map((row) => renderMaterialRowGroup(row))
          )}
        </table>
      </section>

      {periodRows.length > 0 ? (
        <section className="md-print-page-period">
          <h2 className="md-print-section-title">Necessidade por período</h2>
          {periodTruncated ? (
            <p className="md-print-note">
              Exibindo as primeiras {periodRows.length} de {data.needByPeriod.length} linhas agrupadas por período e
              matéria-prima.
            </p>
          ) : null}
          <table className="md-print-period-table">
            <thead>
              <tr>
                <th className="md-print-col-period">Período</th>
                <th className="md-print-col-code">Código</th>
                <th className="md-print-cell-description">Descrição</th>
                <th className="md-print-col-unit">Un.</th>
                <th className="md-print-cell-qty md-print-num">Qtd. est.</th>
                <th className="md-print-cell-money md-print-num">Valor est.</th>
              </tr>
            </thead>
            <tbody>
              {periodRows.map((row) => (
                <tr key={`${row.period}-${row.materialId}-${row.unitLabel}`}>
                  <td className="md-print-col-period">{row.periodLabel}</td>
                  <td className="md-print-col-code">{row.code ?? "—"}</td>
                  <td className="md-print-cell-description">{row.description}</td>
                  <td className="md-print-col-unit">{row.unitLabel}</td>
                  <td className="md-print-cell-qty md-print-num">{fmtNum(row.quantity)}</td>
                  <td className="md-print-cell-money md-print-num">{fmtMoney(row.estimatedValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <footer className="md-print-footer">
        <p>Relatório gerado em {formatGeneratedAt(data.generatedAt)}</p>
        <p>Fonte: pedidos de venda filtrados + composição atual dos produtos</p>
        <p>Não representa estoque, compra em aberto ou consumo real.</p>
        <p>IndusCost — {data.context === "sales-orders" ? "Pedidos de venda" : "Engenharia"}</p>
      </footer>
    </div>
  );
}
