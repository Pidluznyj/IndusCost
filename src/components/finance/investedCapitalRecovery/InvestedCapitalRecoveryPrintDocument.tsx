/**
 * PDF de Financeiro > Recuperação do Dinheiro Investido (Visão Geral) — mesma
 * leitura em blocos da tela (economia, o que já aconteceu, o que ainda tem
 * para entrar, leitura gerencial) e a tabela analítica. Só renderiza o DTO:
 * todos os totais, inclusive os do rodapé da tabela, vêm dos KPIs do backend.
 */
import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  formatFinanceCurrency,
  formatFinanceDateTime,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  INVESTED_CAPITAL_RECOVERY_PRINT_DATA_SOURCE,
  INVESTED_CAPITAL_RECOVERY_PRINT_DISCLAIMER,
  INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_HIGHLIGHT,
  INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_TITLE,
  INVESTED_CAPITAL_RECOVERY_PRINT_FOOTER_NOTE,
  INVESTED_CAPITAL_RECOVERY_PRINT_SUBTITLE,
} from "@/src/lib/finance/salesOrderInvestedCapitalRecoveryPrintMeta";
import type { InvestedCapitalRecoveryPayload } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

function money(value: number | null): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
}

function moneyTable(value: number | null): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinancePercent(value);
}

function formatMonthYear(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const trimmed = dateStr.trim();
  if (!trimmed) return "—";
  if (trimmed.length === 7 && trimmed.includes("-")) {
    const [year, month] = trimmed.split("-");
    return `${month}/${year.slice(-2)}`;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return "—";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${month}/${year}`;
}

type SummaryTone = "positive" | "warning" | "risk" | "info";

function SummaryKpiCard({ label, value, tone }: { label: string; value: string; tone?: SummaryTone }) {
  return (
    <div className={`sales-orders-print-summary-card${tone ? ` sales-orders-print-summary-card--${tone}` : ""}`}>
      <p className="sales-orders-print-summary-card-label">{label}</p>
      <p className="sales-orders-print-summary-card-value">{value}</p>
    </div>
  );
}

type FormulaTerm = { label: string; amount: number | null };

/** "Resultado = Termo + Termo" com os valores já reconciliados pelo backend. */
function FormulaTable({ result, terms }: { result: FormulaTerm; terms: FormulaTerm[] }) {
  const cells: Array<{ text: string; amount?: number | null; operator?: boolean }> = [{ text: result.label, amount: result.amount }];
  terms.forEach((term, index) => {
    cells.push({ text: index === 0 ? "=" : "+", operator: true });
    cells.push({ text: term.label, amount: term.amount });
  });
  return (
    <table className="sales-orders-icr-print-formula-table">
      <thead>
        <tr>
          {cells.map((cell, index) => (
            <th key={index} style={cell.operator ? { width: "3%" } : undefined}>{cell.text}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {cells.map((cell, index) => (
            <td
              key={index}
              className={cell.amount != null && cell.amount < 0 ? "col-negative" : undefined}
              style={cell.operator ? { textAlign: "center", fontWeight: 700 } : undefined}
            >
              {cell.operator ? cell.text : money(cell.amount ?? null)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
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
          <h2 className="sales-orders-print-section-title">1. Economia dos pedidos</h2>
          <div className="sales-orders-print-summary-grid sales-orders-print-summary-grid--6">
            <SummaryKpiCard label="Vendemos" value={money(kpis.totalSaleValueAnalyzed)} tone="info" />
            <SummaryKpiCard label="Capital investido" value={money(kpis.investedCapitalAnalyzedTotal)} tone="warning" />
            <SummaryKpiCard label="Custo industrial" value={money(kpis.totalIndustrialCostAnalyzed)} />
            <SummaryKpiCard label="Imposto (incluído no capital)" value={money(kpis.totalTaxesAnalyzed)} />
            <SummaryKpiCard
              label="Margem econômica dos PVs"
              value={money(kpis.economicMarginTotal)}
              tone={kpis.economicMarginTotal < 0 ? "risk" : "positive"}
            />
            <SummaryKpiCard label="Dados insuficientes (PVs)" value={formatFinanceInteger(kpis.ordersInsufficientDataCount)} />
          </div>
          <div className="sales-orders-icr-print-formula-grid">
            <FormulaTable
              result={{ label: "Venda comparável", amount: kpis.comparableSaleValueTotal }}
              terms={[
                { label: "Capital investido", amount: kpis.investedCapitalAnalyzedTotal },
                { label: "Margem econômica", amount: kpis.economicMarginTotal },
              ]}
            />
            <FormulaTable
              result={{ label: "Capital investido", amount: kpis.investedCapitalAnalyzedTotal }}
              terms={[
                { label: "Custo industrial", amount: kpis.totalIndustrialCostAnalyzed },
                { label: "Imposto", amount: kpis.totalTaxesAnalyzed },
              ]}
            />
          </div>
        </section>

        <section className="sales-orders-print-section sales-orders-print-section--summary">
          <h2 className="sales-orders-print-section-title">2. O que já aconteceu</h2>
          <div className="sales-orders-print-summary-grid sales-orders-print-summary-grid--6">
            <SummaryKpiCard label="Capital recuperado" value={money(kpis.capitalRecoveredTotal)} tone="positive" />
            <SummaryKpiCard label="Ganho já realizado" value={money(kpis.realizedGainTotal)} tone="positive" />
            <SummaryKpiCard label="Total recebido (comparável)" value={money(kpis.actualReceivedComparableTotal)} tone="info" />
            <SummaryKpiCard label="Capital na rua hoje" value={money(kpis.moneyOnStreetToday)} tone="warning" />
            <SummaryKpiCard label="% do capital recuperado" value={percent(kpis.capitalRecoveredPercent)} />
            <SummaryKpiCard label="% do capital na rua" value={percent(kpis.moneyOnStreetPercent)} />
          </div>
          <div className="sales-orders-icr-print-formula-grid">
            <FormulaTable
              result={{ label: "Recebido comparável", amount: kpis.actualReceivedComparableTotal }}
              terms={[
                { label: "Capital recuperado", amount: kpis.capitalRecoveredTotal },
                { label: "Ganho realizado", amount: kpis.realizedGainTotal },
              ]}
            />
            <FormulaTable
              result={{ label: "Capital investido", amount: kpis.investedCapitalAnalyzedTotal }}
              terms={[
                { label: "Capital recuperado", amount: kpis.capitalRecoveredTotal },
                { label: "Capital na rua", amount: kpis.moneyOnStreetToday },
              ]}
            />
          </div>
        </section>

        <section className="sales-orders-print-section sales-orders-print-section--summary">
          <h2 className="sales-orders-print-section-title">3. O que ainda tem para entrar</h2>
          <div className="sales-orders-print-summary-grid">
            <SummaryKpiCard label="Falta receber (CR real aberto)" value={money(kpis.totalOutstandingReceivable)} tone="info" />
            <SummaryKpiCard label="Capital a recuperar nos recebíveis" value={money(kpis.capitalReceivableCoveredTotal)} tone="warning" />
            <SummaryKpiCard label="Ganho a receber" value={money(kpis.gainReceivableTotal)} tone="positive" />
            <SummaryKpiCard label="Capital na rua sem CR aberto" value={money(kpis.capitalWithoutOpenReceivableTotal)} tone="risk" />
            <SummaryKpiCard label="CR não classificado (sem custo)" value={money(kpis.outstandingReceivableUnclassifiedTotal)} />
          </div>
          <div className="sales-orders-icr-print-formula-grid">
            <FormulaTable
              result={{ label: "Recebíveis em aberto", amount: kpis.totalOutstandingReceivable }}
              terms={[
                { label: "Capital a recuperar", amount: kpis.capitalReceivableCoveredTotal },
                { label: "Ganho a receber", amount: kpis.gainReceivableTotal },
                { label: "Não classificado", amount: kpis.outstandingReceivableUnclassifiedTotal },
              ]}
            />
            <FormulaTable
              result={{ label: "Capital na rua", amount: kpis.moneyOnStreetToday }}
              terms={[
                { label: "Capital no CR aberto", amount: kpis.capitalReceivableCoveredTotal },
                { label: "Capital sem CR aberto", amount: kpis.capitalWithoutOpenReceivableTotal },
              ]}
            />
          </div>
        </section>

        <section className="sales-orders-print-section sales-orders-print-section--summary">
          <h2 className="sales-orders-print-section-title">4. Leitura gerencial</h2>
          <div className="sales-orders-print-summary-grid">
            <SummaryKpiCard label="Recuperaram capital" value={formatFinanceInteger(kpis.ordersFullyRecoveredCount)} tone="positive" />
            <SummaryKpiCard label="Parcialmente recuperados" value={formatFinanceInteger(kpis.ordersPartiallyRecoveredCount)} tone="warning" />
            <SummaryKpiCard label="Dados insuficientes" value={formatFinanceInteger(kpis.ordersInsufficientDataCount)} />
            <SummaryKpiCard label="Pedidos comparáveis" value={formatFinanceInteger(kpis.ordersComparableCount)} />
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
                    <td>{c.customerName ? (c.customerName.length > 15 ? c.customerName.slice(0, 15) + "…" : c.customerName) : "—"}</td>
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
            5. Detalhamento por pedido ({formatFinanceInteger(rows.length)}
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
                  <th className="col-money" title="Valor líquido do Pedido de Venda">Vendido</th>
                  <th className="col-money" title="Capital investido = custo industrial + imposto">Cap. invest.</th>
                  <th className="col-money" title="Margem econômica = vendido − capital investido">Margem</th>
                  <th className="col-money" title="Recebido (CR real baixado)">Recebido</th>
                  <th className="col-money" title="Capital recuperado">Cap. recup.</th>
                  <th className="col-money" title="Ganho realizado">G. realiz.</th>
                  <th className="col-money" title="Capital na rua">Cap. na rua</th>
                  <th className="col-money" title="Falta receber (CR real aberto)">A receber</th>
                  <th className="col-money" title="Capital a recuperar nos recebíveis">Cap. no CR</th>
                  <th className="col-money" title="Ganho a receber">G. a rec.</th>
                  <th className="col-money" title="Capital na rua sem CR aberto">Cap. s/ CR</th>
                  <th className="col-date" title="Mês/Ano em que o capital foi recuperado">Pagou</th>
                  <th className="col-date" title="Previsão Mês/Ano de recuperação">Prev.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.salesOrderId}>
                    <td className="col-order">{row.orderCode}</td>
                    <td className="col-client">
                      {row.customerName ? (row.customerName.length > 15 ? row.customerName.slice(0, 15) + "…" : row.customerName) : "—"}
                    </td>
                    <td className="col-money">{moneyTable(row.saleValue)}</td>
                    <td className="col-money">{moneyTable(row.investedCapital)}</td>
                    <td className={`col-money${row.economicMargin != null && row.economicMargin < 0 ? " text-rose-600" : ""}`}>{moneyTable(row.economicMargin)}</td>
                    <td className="col-money">{moneyTable(row.actualReceived)}</td>
                    <td className="col-money text-emerald-600 font-medium">{moneyTable(row.capitalRecovered)}</td>
                    <td className="col-money text-emerald-600">{moneyTable(row.realizedGain ?? null)}</td>
                    <td className="col-money text-rose-600 font-medium">{moneyTable(row.moneyOnStreet)}</td>
                    <td className="col-money">{moneyTable(row.outstandingReceivable)}</td>
                    <td className="col-money">{moneyTable(row.capitalReceivableCovered)}</td>
                    <td className="col-money text-emerald-600">{moneyTable(row.gainReceivable)}</td>
                    <td className="col-money text-rose-600">{moneyTable(row.capitalWithoutOpenReceivable)}</td>
                    <td className="col-date">{formatMonthYear(row.capitalRecoveryDate)}</td>
                    <td className="col-date">{formatMonthYear(row.forecastCapitalRecoveryDate)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="sales-orders-print-total-row">
                  <td colSpan={2}>Total</td>
                  <td className="col-money">{moneyTable(kpis.totalSaleValueAnalyzed)}</td>
                  <td className="col-money">{moneyTable(kpis.investedCapitalAnalyzedTotal)}</td>
                  <td className="col-money">{moneyTable(kpis.economicMarginTotal)}</td>
                  <td className="col-money">{moneyTable(kpis.actualReceivedTotal)}</td>
                  <td className="col-money text-emerald-600 font-medium">{moneyTable(kpis.capitalRecoveredTotal)}</td>
                  <td className="col-money text-emerald-600">{moneyTable(kpis.realizedGainTotal)}</td>
                  <td className="col-money text-rose-600 font-medium">{moneyTable(kpis.moneyOnStreetToday)}</td>
                  <td className="col-money">{moneyTable(kpis.totalOutstandingReceivable)}</td>
                  <td className="col-money">{moneyTable(kpis.capitalReceivableCoveredTotal)}</td>
                  <td className="col-money text-emerald-600">{moneyTable(kpis.gainReceivableTotal)}</td>
                  <td className="col-money text-rose-600">{moneyTable(kpis.capitalWithoutOpenReceivableTotal)}</td>
                  <td className="col-num" colSpan={2} />
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
