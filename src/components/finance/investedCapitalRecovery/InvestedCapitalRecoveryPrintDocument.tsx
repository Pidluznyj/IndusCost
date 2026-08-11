import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  INVESTED_CAPITAL_RECOVERY_PRINT_DATA_SOURCE,
  INVESTED_CAPITAL_RECOVERY_PRINT_DISCLAIMER,
  INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_HIGHLIGHT,
  INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_TITLE,
  INVESTED_CAPITAL_RECOVERY_PRINT_FOOTER_NOTE,
  INVESTED_CAPITAL_RECOVERY_PRINT_SUBTITLE,
} from "@/src/lib/finance/salesOrderInvestedCapitalRecoveryPrintMeta";
import type {
  InvestedCapitalRecoveryPayload,
  InvestedCapitalRecoveryStatus,
} from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

const STATUS_PRINT_LABELS: Record<InvestedCapitalRecoveryStatus, string> = {
  SEM_RECUPERACAO: "Sem recup.",
  EM_RECUPERACAO: "Em recup.",
  CAPITAL_RECUPERADO: "Recuperado",
  DADOS_INSUFFICIENTES: "Sem dados",
};

function money(value: number | null): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
}

function moneyTable(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMonthYear(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const trimmed = dateStr.trim();
  if (!trimmed) return "—";
  if (trimmed.length === 7 && trimmed.includes("-")) {
    const [year, month] = trimmed.split("-");
    return `${month}/${year}`;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return "—";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${month}/${year}`;
}

function SummaryKpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="sales-orders-print-summary-card">
      <p className="sales-orders-print-summary-card-label">{label}</p>
      <p className="sales-orders-print-summary-card-value">{value}</p>
    </div>
  );
}

export function InvestedCapitalRecoveryPrintDocument({
  payload,
  branding,
  filterLabels,
}: {
  payload: InvestedCapitalRecoveryPayload;
  branding: BrandingSettingsDTO;
  filterLabels: string;
}) {
  const { kpis, agingBuckets, topCustomers, rows } = payload;

  const totalActualReceived = useMemo(
    () => rows.reduce((acc, r) => acc + (r.actualReceived || 0), 0),
    [rows]
  );

  const metaLines = useMemo(
    () => [
      { label: "Emitido em", value: formatFinanceDateTime(payload.generatedAt) },
      { label: "Pedidos analisados", value: formatFinanceInteger(rows.length) },
      { label: "Origem", value: INVESTED_CAPITAL_RECOVERY_PRINT_DATA_SOURCE },
    ],
    [payload.generatedAt, rows.length]
  );

  return (
    <div id="sales-orders-print-root">
      <div className="sales-orders-print-document">
        <div className="sales-orders-print-cover">
          <PrintHeader
            branding={branding}
            documentTitle={INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_TITLE}
            documentHighlight={INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_HIGHLIGHT}
            metaLines={metaLines}
            subtitle={INVESTED_CAPITAL_RECOVERY_PRINT_SUBTITLE}
            className="sales-orders-print-doc-header"
          />
          {filterLabels ? (
            <div className="sales-orders-print-filter-band">
              <p className="sales-orders-print-filter-band-label">Filtros aplicados</p>
              <p className="sales-orders-print-filter-band-value">{filterLabels}</p>
            </div>
          ) : null}
        </div>

        <section className="sales-orders-print-section sales-orders-print-section--summary">
          <h2 className="sales-orders-print-section-title">Resumo executivo</h2>
          <div className="sales-orders-print-summary-grid">
            <SummaryKpiCard label="Vendemos (Total Vendido)" value={money(kpis.totalSaleValueAnalyzed)} />
            <SummaryKpiCard
              label="Investimos (Capital = Custo + Imposto)"
              value={money(kpis.investedCapitalAnalyzedTotal)}
            />
            <SummaryKpiCard label="Custo Industrial Total" value={money(kpis.totalIndustrialCostAnalyzed)} />
            <SummaryKpiCard label="Imposto Total (incluído no capital)" value={money(kpis.totalTaxesAnalyzed)} />
            <SummaryKpiCard label="Falta Receber" value={money(kpis.totalOutstandingReceivable)} />
            <SummaryKpiCard label="Dinheiro na Rua Hoje" value={money(kpis.moneyOnStreetToday)} />
            <SummaryKpiCard label="Capital Recuperado" value={money(kpis.capitalRecoveredTotal)} />
            <SummaryKpiCard
              label="Recuperaram capital"
              value={formatFinanceInteger(kpis.ordersFullyRecoveredCount)}
            />
            <SummaryKpiCard
              label="Parcialmente recuperados"
              value={formatFinanceInteger(kpis.ordersPartiallyRecoveredCount)}
            />
            <SummaryKpiCard
              label="Dados insuficientes"
              value={formatFinanceInteger(kpis.ordersInsufficientDataCount)}
            />
            <SummaryKpiCard
              label="Prazo médio realizado"
              value={
                kpis.averageDaysToRecoverCapital == null
                  ? "—"
                  : `${kpis.averageDaysToRecoverCapital} dias`
              }
            />
          </div>
        </section>

        <p className="sales-orders-print-disclaimer">
          {INVESTED_CAPITAL_RECOVERY_PRINT_DISCLAIMER}
        </p>

        <section className="sales-orders-print-section sales-orders-print-section--summary">
          <h2 className="sales-orders-print-section-title">Capital na Rua por Faixa</h2>
          <table className="sales-orders-icr-print-aging-table">
            <thead>
              <tr>
                {agingBuckets.map((b) => (
                  <th key={b.key}>{b.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {agingBuckets.map((b) => (
                  <td key={b.key}>{money(b.amount)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>

        {topCustomers.length > 0 ? (
          <section className="sales-orders-print-section sales-orders-print-section--summary">
            <h2 className="sales-orders-print-section-title">Top Clientes — Capital na Rua</h2>
            <table className="sales-orders-icr-print-top-customers-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Dinheiro na Rua</th>
                  <th>% do Total</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c) => (
                  <tr key={c.customerName}>
                    <td>{displayFinanceText(c.customerName)}</td>
                    <td>{money(c.moneyOnStreet)}</td>
                    <td>{c.percentOfTotal.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="sales-orders-print-section sales-orders-print-section--detail">
          <h2 className="sales-orders-print-section-title">
            Detalhamento analítico ({formatFinanceInteger(rows.length)}
            {payload.truncated ? ` de ${formatFinanceInteger(payload.totalOrdersInScope)}` : ""}) — Valores em R$
          </h2>
          {rows.length === 0 ? (
            <p className="sales-orders-print-empty">
              Nenhum pedido encontrado para os filtros selecionados.
            </p>
          ) : (
            <table className="sales-orders-icr-print-table">
              <thead>
                <tr>
                  <th className="col-order" title="Pedido de Venda">PV</th>
                  <th className="col-client" title="Nome do Cliente">Cliente</th>
                  <th className="col-money" title="Valor do Pedido de Venda">Venda</th>
                  <th className="col-money" title="Capital Investido (Imposto + Custo de Produção)">Cap. Invest.</th>
                  <th className="col-money" title="Imposto">Imposto</th>
                  <th className="col-money" title="Custo de Produção">Custo Prod.</th>
                  <th className="col-money" title="Recebido">Recebido</th>
                  <th className="col-money" title="Capital Recuperado">Cap. Recup.</th>
                  <th className="col-money" title="Capital na Rua">Cap. na Rua</th>
                  <th className="col-money" title="A Receber">A Receber</th>
                  <th className="col-num" title="Percentual Recuperado">% Rec.</th>
                  <th className="col-date" title="Mês/Ano em que o capital foi pago">Pagou</th>
                  <th className="col-date" title="Previsão Mês/Ano de recuperação">Prev.</th>
                  <th className="col-status" title="Status Econômico">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.salesOrderId}>
                    <td className="col-order">{row.orderCode}</td>
                    <td className="col-client">{displayFinanceText(row.customerName)}</td>
                    <td className="col-money">{moneyTable(row.saleValue)}</td>
                    <td className="col-money">{moneyTable(row.investedCapital)}</td>
                    <td className="col-money">{moneyTable(row.totalTaxes)}</td>
                    <td className="col-money">{moneyTable(row.industrialCost)}</td>
                    <td className="col-money">{moneyTable(row.actualReceived)}</td>
                    <td className="col-money">{moneyTable(row.capitalRecovered)}</td>
                    <td className="col-money">{moneyTable(row.moneyOnStreet)}</td>
                    <td className="col-money">{moneyTable(row.outstandingReceivable)}</td>
                    <td className="col-num">
                      {row.recoveryPercent == null ? "—" : `${row.recoveryPercent.toFixed(0)}%`}
                    </td>
                    <td className="col-date">{formatMonthYear(row.capitalRecoveryDate)}</td>
                    <td className="col-date">{formatMonthYear(row.forecastCapitalRecoveryDate)}</td>
                    <td className="col-status">{STATUS_PRINT_LABELS[row.status]}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="sales-orders-print-total-row">
                  <td colSpan={2}>Total</td>
                  <td className="col-money">{moneyTable(kpis.totalSaleValueAnalyzed)}</td>
                  <td className="col-money">{moneyTable(kpis.investedCapitalAnalyzedTotal)}</td>
                  <td className="col-money">{moneyTable(kpis.totalTaxesAnalyzed)}</td>
                  <td className="col-money">{moneyTable(kpis.totalIndustrialCostAnalyzed)}</td>
                  <td className="col-money">{moneyTable(totalActualReceived)}</td>
                  <td className="col-money">{moneyTable(kpis.capitalRecoveredTotal)}</td>
                  <td className="col-money">{moneyTable(kpis.moneyOnStreetToday)}</td>
                  <td className="col-money">{moneyTable(kpis.totalOutstandingReceivable)}</td>
                  <td className="col-num" colSpan={4} />
                </tr>
              </tfoot>
            </table>
          )}

          {payload.truncated ? (
            <p className="sales-orders-print-empty">
              Foram exibidos {formatFinanceInteger(rows.length)} de{" "}
              {formatFinanceInteger(payload.totalOrdersInScope)} pedidos filtrados. Ajuste os
              filtros para visualizar o restante.
            </p>
          ) : null}
        </section>

        <footer className="sales-orders-print-footer">
          <p>{INVESTED_CAPITAL_RECOVERY_PRINT_FOOTER_NOTE}</p>
          <p>{formatFinanceDateTime(payload.generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}
