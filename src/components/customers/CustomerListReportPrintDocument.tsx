import React from "react";
import "@/src/components/print/print-document.css";
import "./customer-list-report-print.css";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { CustomerListReportExportPayload } from "@/src/lib/customerListReportExport";
import {
  CUSTOMER_LIST_REPORT_CLASSIFICATION,
  CUSTOMER_LIST_REPORT_PRINT_DATA_SOURCE,
  CUSTOMER_LIST_REPORT_PRINT_DISCLAIMER,
  CUSTOMER_LIST_REPORT_PRINT_DOCUMENT_HIGHLIGHT,
  CUSTOMER_LIST_REPORT_PRINT_DOCUMENT_TITLE,
  CUSTOMER_LIST_REPORT_PRINT_FOOTER_NOTE,
  CUSTOMER_LIST_REPORT_PRINT_NOTICE,
  CUSTOMER_LIST_REPORT_PRINT_SUBTITLE,
  CUSTOMER_LIST_REPORT_WATERMARK,
} from "@/src/lib/customerListReportPrintMeta";

function SummaryKpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "risk" | "ok" | "muted";
}) {
  return (
    <div
      className={[
        "customers-print-summary-card",
        tone ? `customers-print-summary-card--${tone}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="customers-print-summary-card-label">{label}</p>
      <p className="customers-print-summary-card-value">{value}</p>
    </div>
  );
}

function statusToneClass(status: string): string {
  if (status === "Ativo") return "customers-print-status customers-print-status--ok";
  return "customers-print-status customers-print-status--risk";
}

export function CustomerListReportPrintDocument({
  payload,
  branding,
}: {
  payload: CustomerListReportExportPayload;
  branding: BrandingSettingsDTO;
}) {
  const { summary, rows, copyControl } = payload;
  const filterLines = payload.appliedFilters
    .map((line) => `${line.label}: ${line.value}`)
    .join(" · ");

  return (
    <div id="customers-print-root">
      <div className="customers-print-watermark" aria-hidden="true">
        {CUSTOMER_LIST_REPORT_WATERMARK}
      </div>
      <div className="customers-print-document">
        <div className="customers-print-cover">
          <PrintHeader
            branding={branding}
            documentTitle={CUSTOMER_LIST_REPORT_PRINT_DOCUMENT_TITLE}
            documentHighlight={CUSTOMER_LIST_REPORT_PRINT_DOCUMENT_HIGHLIGHT}
            subtitle={CUSTOMER_LIST_REPORT_PRINT_SUBTITLE}
            className="customers-print-doc-header"
            metaLines={[
              { label: "Emitido em", value: formatFinanceDateTime(payload.generatedAt) },
              { label: "Emitido por", value: copyControl.emitterName || "—" },
              { label: "Clientes", value: formatFinanceInteger(summary.exportedCount) },
              { label: "Origem", value: CUSTOMER_LIST_REPORT_PRINT_DATA_SOURCE },
              { label: "Cópia", value: copyControl.copyCode },
            ]}
          />
          <div className="customers-print-classification">
            <p className="customers-print-classification-title">
              {copyControl.classification || CUSTOMER_LIST_REPORT_CLASSIFICATION}
            </p>
            <p>
              Destinatário: {copyControl.emitterName} · {copyControl.emitterEmail} · SHA-256{" "}
              {copyControl.fingerprint.slice(0, 16)}…
            </p>
          </div>
          {filterLines ? (
            <div className="customers-print-filter-band">
              <p className="customers-print-filter-band-label">Filtros aplicados</p>
              <p className="customers-print-filter-band-value">{filterLines}</p>
            </div>
          ) : null}
        </div>

        <section className="customers-print-section">
          <h2 className="customers-print-section-title">Resumo executivo</h2>
          <div className="customers-print-summary-grid">
            <SummaryKpiCard label="Clientes no filtro" value={formatFinanceInteger(summary.customersCount)} />
            <SummaryKpiCard
              label="Exportados"
              value={formatFinanceInteger(summary.exportedCount)}
              tone="ok"
            />
            <SummaryKpiCard
              label="Com score CNPJ"
              value={formatFinanceInteger(summary.withCnpjScoreCount)}
            />
            <SummaryKpiCard
              label="Sem consulta"
              value={formatFinanceInteger(summary.withoutCnpjScoreCount)}
              tone="muted"
            />
            <SummaryKpiCard
              label="Status ativo"
              value={formatFinanceInteger(summary.activeCount)}
              tone="ok"
            />
            <SummaryKpiCard
              label="Venda bloqueada"
              value={formatFinanceInteger(summary.salesBlockedCount)}
              tone={summary.salesBlockedCount > 0 ? "risk" : "ok"}
            />
          </div>
        </section>

        <div className="customers-print-disclaimer-box">
          <p className="customers-print-disclaimer-title">{CUSTOMER_LIST_REPORT_PRINT_NOTICE[0]}</p>
          <p className="customers-print-disclaimer">{CUSTOMER_LIST_REPORT_PRINT_DISCLAIMER}</p>
        </div>

        <section className="customers-print-section">
          <h2 className="customers-print-section-title">
            Detalhamento da carteira ({formatFinanceInteger(rows.length)}
            {summary.truncated ? ` de ${formatFinanceInteger(summary.customersCount)}` : ""})
          </h2>
          {rows.length === 0 ? (
            <p className="customers-print-empty">Nenhum cliente encontrado para os filtros selecionados.</p>
          ) : (
            <table className="customers-print-data-table">
              <thead>
                <tr>
                  <th className="col-client">Razão social</th>
                  <th className="col-trade">Nome fantasia</th>
                  <th className="col-cnpj">CNPJ</th>
                  <th className="col-score">Score CNPJ</th>
                  <th className="col-owner">Responsável</th>
                  <th className="col-purchase">Última compra</th>
                  <th className="col-city">Localização</th>
                  <th className="col-seg">Segmento</th>
                  <th className="col-status">Status</th>
                  <th className="col-block">Bloqueio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.taxId}-${index}`}>
                    <td className="col-client">{row.companyName}</td>
                    <td className="col-trade">{row.tradeName}</td>
                    <td className="col-cnpj">{row.taxId}</td>
                    <td className="col-score">{row.cnpjScore}</td>
                    <td className="col-owner">{row.commercialOwnerName}</td>
                    <td className="col-purchase">{row.lastPurchase}</td>
                    <td className="col-city">
                      {row.city} - {row.state}
                    </td>
                    <td className="col-seg">{row.segment}</td>
                    <td className="col-status">
                      <span className={statusToneClass(row.status)}>{row.status}</span>
                    </td>
                    <td className="col-block">{row.salesBlock || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.truncated ? (
            <p className="customers-print-empty">
              Foram exibidos {formatFinanceInteger(rows.length)} de{" "}
              {formatFinanceInteger(summary.customersCount)} clientes filtrados. Refine o filtro
              para a lista completa.
            </p>
          ) : null}
        </section>

        <footer className="customers-print-footer">
          <p>{CUSTOMER_LIST_REPORT_PRINT_FOOTER_NOTE}</p>
          <p>
            Cópia {copyControl.copyCode} · SHA-256 {copyControl.fingerprint} ·{" "}
            {formatFinanceDateTime(payload.generatedAt)} · {copyControl.emitterName}
          </p>
        </footer>
        <div className="customers-print-stamp">
          {CUSTOMER_LIST_REPORT_CLASSIFICATION} · {copyControl.copyCode} · {copyControl.emitterEmail} ·
          uso interno — não compartilhar
        </div>
      </div>
    </div>
  );
}
