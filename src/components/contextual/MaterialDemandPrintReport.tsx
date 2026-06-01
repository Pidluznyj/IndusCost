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

function PrintTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <table className={className ?? "md-print-table"}>
      {children}
    </table>
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
      <header className="md-print-header">
        <h1 className="md-print-title">Estimativa de uso de matéria-prima</h1>
        <p className="md-print-subtitle">Base: pedidos de venda</p>
        <p className="md-print-context">{contextLine}</p>
        <p className="md-print-disclaimer">
          Estimativa calculada com base nos pedidos de venda filtrados e na composição atual dos produtos. Não
          considera estoque disponível, compras em aberto ou consumo real de fábrica.
        </p>
      </header>

      <section className="md-print-section">
        <h2 className="md-print-section-title">Resumo executivo</h2>
        <PrintTable className="md-print-kpi-table">
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
        </PrintTable>
        {data.coverage &&
        (data.coverage.orderItemsSkippedInvalidQty > 0 ||
          data.coverage.orderItemsSkippedAnalysisFailure > 0 ||
          data.coverage.orderItemsSkippedExplosionError > 0 ||
          data.coverage.orderItemsSkippedNoMaterials > 0) ? (
          <p className="md-print-note">
            Itens ignorados: inválidos {data.coverage.orderItemsSkippedInvalidQty}, análise{" "}
            {data.coverage.orderItemsSkippedAnalysisFailure}, explosão {data.coverage.orderItemsSkippedExplosionError},
            sem MP {data.coverage.orderItemsSkippedNoMaterials}.
          </p>
        ) : null}
      </section>

      <section className="md-print-section md-print-section-break">
        <h2 className="md-print-section-title">Matérias-primas — estimativa de uso</h2>
        <p className="md-print-note">
          Ordenação: {data.sortLabel} (decrescente).
          {rowsTruncated
            ? ` Relatório impresso com as primeiras ${data.rows.length} de ${data.rowsTotalItems} matérias-primas conforme ordenação atual.`
            : ` Total: ${data.rowsTotalItems} matérias-primas.`}
        </p>
        <PrintTable className="md-print-data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Un.</th>
              <th className="md-print-num">Qtd. est.</th>
              <th className="md-print-num">Valor est.</th>
              <th className="md-print-num">Custo unit.</th>
              <th className="md-print-num">Ped.</th>
              <th className="md-print-num">Prod.</th>
              <th className="md-print-num">Cli.</th>
              <th>Principal produto</th>
              <th>Principal cliente</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={11}>Nenhuma matéria-prima para os filtros selecionados.</td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.materialId}>
                  <td>{row.code ?? "—"}</td>
                  <td className="md-print-desc">{row.description}</td>
                  <td>{row.unit ?? row.unitLabel ?? "—"}</td>
                  <td className="md-print-num">{fmtNum(row.quantityTotal)}</td>
                  <td className="md-print-num">{fmtMoney(row.estimatedValueTotal)}</td>
                  <td className="md-print-num">{fmtMoney(row.unitCostReference)}</td>
                  <td className="md-print-num">{row.orderCount}</td>
                  <td className="md-print-num">{row.productCount}</td>
                  <td className="md-print-num">{row.customerCount ?? "—"}</td>
                  <td className="md-print-desc-sm">
                    {row.leadingProduct
                      ? productLabel(row.leadingProduct.sku, row.leadingProduct.name)
                      : "—"}
                  </td>
                  <td className="md-print-desc-sm">{row.leadingCustomer?.customerName ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </PrintTable>
      </section>

      {periodRows.length > 0 ? (
        <section className="md-print-section md-print-section-break">
          <h2 className="md-print-section-title">Necessidade por período</h2>
          {periodTruncated ? (
            <p className="md-print-note">
              Exibindo as primeiras {periodRows.length} de {data.needByPeriod.length} linhas agrupadas por período e
              matéria-prima.
            </p>
          ) : null}
          <PrintTable className="md-print-data-table md-print-period-table">
            <thead>
              <tr>
                <th>Período</th>
                <th>Código</th>
                <th>Descrição</th>
                <th>Un.</th>
                <th className="md-print-num">Qtd. est.</th>
                <th className="md-print-num">Valor est.</th>
              </tr>
            </thead>
            <tbody>
              {periodRows.map((row) => (
                <tr key={`${row.period}-${row.materialId}-${row.unitLabel}`}>
                  <td>{row.periodLabel}</td>
                  <td>{row.code ?? "—"}</td>
                  <td className="md-print-desc">{row.description}</td>
                  <td>{row.unitLabel}</td>
                  <td className="md-print-num">{fmtNum(row.quantity)}</td>
                  <td className="md-print-num">{fmtMoney(row.estimatedValue)}</td>
                </tr>
              ))}
            </tbody>
          </PrintTable>
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
