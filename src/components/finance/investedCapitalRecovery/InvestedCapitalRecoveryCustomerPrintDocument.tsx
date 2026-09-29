import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  formatFinanceCurrency,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  INVESTED_CAPITAL_RECOVERY_CUSTOMER_PRINT_SUBTITLE,
  INVESTED_CAPITAL_RECOVERY_PRINT_DATA_SOURCE,
  INVESTED_CAPITAL_RECOVERY_PRINT_DISCLAIMER,
  INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_HIGHLIGHT,
  INVESTED_CAPITAL_RECOVERY_PRINT_DOCUMENT_TITLE,
  INVESTED_CAPITAL_RECOVERY_PRINT_FOOTER_NOTE,
} from "@/src/lib/finance/salesOrderInvestedCapitalRecoveryPrintMeta";
import type { InvestedCapitalRecoveryByCustomer } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

function money(value: number | null): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
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

export function InvestedCapitalRecoveryCustomerPrintDocument({
  byCustomer,
  generatedAt,
  branding,
  filterLabels,
}: {
  byCustomer: InvestedCapitalRecoveryByCustomer;
  generatedAt: string;
  branding: BrandingSettingsDTO;
  filterLabels: string;
}) {
  const summary = byCustomer.summary;
  const metaLines = useMemo(
    () => [
      { label: "Emitido em", value: formatFinanceDateTime(generatedAt) },
      { label: "Clientes", value: formatFinanceInteger(summary.customers) },
      { label: "Origem", value: INVESTED_CAPITAL_RECOVERY_PRINT_DATA_SOURCE },
    ],
    [generatedAt, summary.customers]
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
            subtitle={INVESTED_CAPITAL_RECOVERY_CUSTOMER_PRINT_SUBTITLE}
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
          <h2 className="sales-orders-print-section-title">Economia dos pedidos por cliente</h2>
          <div className="sales-orders-print-summary-grid sales-orders-print-summary-grid--6">
            <SummaryKpiCard label="Vendemos" value={money(summary.sold)} tone="info" />
            <SummaryKpiCard label="Faturado" value={money(summary.invoiced)} />
            <SummaryKpiCard label="Capital investido" value={money(summary.investedCapital)} tone="warning" />
            <SummaryKpiCard
              label="Margem econômica"
              value={money(summary.economicMargin)}
              tone={summary.economicMargin != null && summary.economicMargin < 0 ? "risk" : "positive"}
            />
            <SummaryKpiCard label="Saldo econômico atual" value={money(summary.potentialResult)} />
            <SummaryKpiCard label="Pedidos" value={formatFinanceInteger(summary.orders)} />
          </div>
          <h2 className="sales-orders-print-section-title">O que já entrou e o que ainda tem para entrar</h2>
          <div className="sales-orders-print-summary-grid sales-orders-print-summary-grid--6">
            <SummaryKpiCard label="Recebido" value={money(summary.received)} tone="info" />
            <SummaryKpiCard label="Capital recuperado" value={money(summary.recoveredCapital)} tone="positive" />
            <SummaryKpiCard label="Ganho realizado" value={money(summary.realizedGain)} tone="positive" />
            <SummaryKpiCard label="Dinheiro na rua" value={money(summary.capitalAtRisk)} tone="warning" />
            <SummaryKpiCard label="Falta receber" value={money(summary.outstandingReceivable)} />
            <SummaryKpiCard label="Capital a recuperar nos recebíveis" value={money(summary.capitalReceivableCovered)} tone="warning" />
            <SummaryKpiCard label="Ganho a receber" value={money(summary.gainReceivable)} tone="positive" />
            <SummaryKpiCard label="Capital na rua sem CR aberto" value={money(summary.capitalWithoutOpenReceivable)} tone="risk" />
          </div>
          <p className="sales-orders-print-disclaimer">{INVESTED_CAPITAL_RECOVERY_PRINT_DISCLAIMER}</p>
        </section>

        <section className="sales-orders-print-section sales-orders-print-section--detail">
          <h2 className="sales-orders-print-section-title">
            Consolidado por cliente ({formatFinanceInteger(byCustomer.customers.length)}) — Valores em R$
          </h2>
          {byCustomer.customers.length === 0 ? (
            <p className="sales-orders-print-empty">Nenhum dado encontrado para os filtros selecionados.</p>
          ) : (
            <table className="sales-orders-icr-print-table sales-orders-icr-customer-print-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Pedidos</th>
                  <th>Faturado</th>
                  <th>Cap. invest.</th>
                  <th>Margem econ.</th>
                  <th>Recebido</th>
                  <th>Cap. recup.</th>
                  <th>Ganho realiz.</th>
                  <th>Na rua</th>
                  <th>Falta receber</th>
                  <th>Cap. no CR</th>
                  <th>Ganho a rec.</th>
                  <th>Cap. s/ CR</th>
                  <th>Saldo atual</th>
                </tr>
              </thead>
              <tbody>
                {byCustomer.customers.map((row) => (
                  <tr key={row.customerKey}>
                    <td>{row.customerName}</td>
                    <td>{row.orders}</td>
                    <td>{money(row.invoiced)}</td>
                    <td>{money(row.investedCapital)}</td>
                    <td>{money(row.economicMargin)}</td>
                    <td>{money(row.received)}</td>
                    <td>{money(row.recoveredCapital)}</td>
                    <td>{money(row.realizedGain)}</td>
                    <td>{money(row.capitalAtRisk)}</td>
                    <td>{money(row.outstandingReceivable)}</td>
                    <td>{money(row.capitalReceivableCovered)}</td>
                    <td>{money(row.gainReceivable)}</td>
                    <td>{money(row.capitalWithoutOpenReceivable)}</td>
                    <td>{money(row.potentialResult)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="sales-orders-print-disclaimer">{INVESTED_CAPITAL_RECOVERY_PRINT_FOOTER_NOTE}</p>
        </section>
      </div>
    </div>
  );
}
