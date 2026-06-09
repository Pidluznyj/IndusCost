import React from "react";
import {
  formatCnpjPrintDateTime,
  formatCnpjPrintMoney,
  formatCnpjPrintScore,
  formatCnpjPrintText,
  type CnpjIntelligencePrintPayload,
} from "@/src/lib/customerCnpjIntelligencePrint";
import { CNPJ_COMPARE_STATUS_LABEL } from "@/src/lib/customerCnpjIntelligenceTypes";

type Props = {
  data: CnpjIntelligencePrintPayload;
};

function cnaeLabel(code: string | null | undefined, description: string | null | undefined): string {
  const c = code?.trim();
  const d = description?.trim();
  if (c && d) return `${c} — ${d}`;
  return d || c || "—";
}

export function CnpjCommercialIntelligencePrintReport({ data }: Props) {
  const { summary } = data;
  const addressLine = [
    summary.address,
    summary.city && summary.state ? `${summary.city}/${summary.state}` : summary.city ?? summary.state,
    summary.zipCode ? `CEP ${summary.zipCode}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="cnpj-intelligence-print-report">
      <header className="cnpj-intelligence-print-header cnpj-intelligence-print-section">
        <p className="cnpj-intelligence-print-brand">IndusCost</p>
        <h1 className="cnpj-intelligence-print-title">Relatório de Inteligência Comercial</h1>
        <p className="cnpj-intelligence-print-meta">
          Emitido em {formatCnpjPrintDateTime(data.generatedAt)}
        </p>
        <table className="cnpj-intelligence-print-ident-table">
          <tbody>
            <tr>
              <th>CNPJ</th>
              <td>{formatCnpjPrintText(summary.cnpjFormatted)}</td>
              <th>Situação cadastral</th>
              <td>{formatCnpjPrintText(summary.registrationStatus)}</td>
            </tr>
            <tr>
              <th>Razão social</th>
              <td colSpan={3}>{formatCnpjPrintText(summary.companyName)}</td>
            </tr>
            {summary.tradeName ? (
              <tr>
                <th>Nome fantasia</th>
                <td colSpan={3}>{formatCnpjPrintText(summary.tradeName)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </header>

      <section className="cnpj-intelligence-print-section cnpj-intelligence-print-risk">
        <h2 className="cnpj-intelligence-print-section-title">Análise de risco comercial</h2>
        <p className="cnpj-intelligence-print-lead">
          Score: {formatCnpjPrintScore(data.risk.score)} · {formatCnpjPrintText(data.risk.verdict)}
        </p>
        <p>
          Risco: {formatCnpjPrintText(data.risk.riskLevel)} —{" "}
          {formatCnpjPrintText(data.risk.saleRecommendation)}
        </p>
        {data.risk.explanation.length > 0 ? (
          <ul className="cnpj-intelligence-print-list">
            {data.risk.explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="cnpj-intelligence-print-note">{formatCnpjPrintText(data.commercial.disclaimer)}</p>
      </section>

      <section className="cnpj-intelligence-print-section">
        <h2 className="cnpj-intelligence-print-section-title">Dados oficiais da empresa</h2>
        <table className="cnpj-intelligence-print-kv-table">
          <tbody>
            <tr>
              <th>Abertura</th>
              <td>{formatCnpjPrintText(summary.openedAt)}</td>
              <th>Porte</th>
              <td>{formatCnpjPrintText(summary.companySize)}</td>
            </tr>
            <tr>
              <th>Natureza jurídica</th>
              <td>{formatCnpjPrintText(summary.legalNature)}</td>
              <th>Capital social</th>
              <td>{formatCnpjPrintMoney(summary.shareCapital)}</td>
            </tr>
            <tr>
              <th>CNAE principal</th>
              <td colSpan={3}>
                {cnaeLabel(summary.mainCnae?.code, summary.mainCnae?.description)}
              </td>
            </tr>
            {summary.secondaryCnaes.length > 0 ? (
              <tr>
                <th>CNAEs secundários</th>
                <td colSpan={3}>
                  {summary.secondaryCnaes
                    .map((c) => cnaeLabel(c.code, c.description))
                    .join(" · ")}
                </td>
              </tr>
            ) : null}
            <tr>
              <th>Endereço fiscal</th>
              <td colSpan={3}>{formatCnpjPrintText(addressLine || null)}</td>
            </tr>
            <tr>
              <th>Inscrição estadual</th>
              <td colSpan={3}>
                {summary.stateTaxIds[0]?.number
                  ? `${summary.stateTaxIds[0].number} (${formatCnpjPrintText(summary.stateTaxIds[0].status)})`
                  : "—"}
              </td>
            </tr>
            {summary.phone || summary.email ? (
              <tr>
                <th>Contatos no cadastro público</th>
                <td colSpan={3}>
                  {[summary.phone ? `Tel: ${summary.phone}` : null, summary.email ? `E-mail: ${summary.email}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {summary.partners.length > 0 ? (
        <section className="cnpj-intelligence-print-section">
          <h2 className="cnpj-intelligence-print-section-title">Quadro societário (QSA)</h2>
          <table className="cnpj-intelligence-print-data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Qualificação</th>
              </tr>
            </thead>
            <tbody>
              {summary.partners.map((p, i) => (
                <tr key={`${p.name}-${i}`}>
                  <td>{formatCnpjPrintText(p.name)}</td>
                  <td>{formatCnpjPrintText(p.role)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="cnpj-intelligence-print-section">
        <h2 className="cnpj-intelligence-print-section-title">Inteligência comercial</h2>
        {data.commercial.insights.length === 0 &&
        data.commercial.crossSell.length === 0 &&
        data.commercial.taxAlerts.length === 0 ? (
          <p className="cnpj-intelligence-print-note">Nenhum insight adicional para este CNPJ.</p>
        ) : null}
        {data.commercial.insights.map((insight) => (
          <div key={insight.code} className="cnpj-intelligence-print-insight">
            <p className="cnpj-intelligence-print-insight-title">{insight.title}</p>
            <p>{insight.description}</p>
          </div>
        ))}
        {data.commercial.crossSell.map((item) => (
          <div key={item.category} className="cnpj-intelligence-print-insight">
            <p className="cnpj-intelligence-print-insight-title">{item.category}</p>
            <p>{item.suggestions.join(" · ") || "—"}</p>
          </div>
        ))}
        {data.commercial.taxAlerts.map((alert) => (
          <p key={alert.code} className="cnpj-intelligence-print-alert">
            {alert.message}
          </p>
        ))}
      </section>

      {data.publicContactSuggestion?.phone || data.publicContactSuggestion?.email ? (
        <section className="cnpj-intelligence-print-section">
          <h2 className="cnpj-intelligence-print-section-title">Contatos públicos do CNPJ</h2>
          <p className="cnpj-intelligence-print-note">
            {formatCnpjPrintText(data.publicContactSuggestion.disclaimer)}
          </p>
          <table className="cnpj-intelligence-print-kv-table">
            <tbody>
              {data.publicContactSuggestion.phone ? (
                <tr>
                  <th>Telefone</th>
                  <td>{data.publicContactSuggestion.phone}</td>
                </tr>
              ) : null}
              {data.publicContactSuggestion.email ? (
                <tr>
                  <th>E-mail</th>
                  <td>{data.publicContactSuggestion.email}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {data.comparison?.erpCommercialFields && data.comparison.erpCommercialFields.length > 0 ? (
        <section className="cnpj-intelligence-print-section">
          <h2 className="cnpj-intelligence-print-section-title">
            Dados comerciais do ERP (fonte interna)
          </h2>
          <p className="cnpj-intelligence-print-note">
            Informações de relacionamento comercial internas; não substituem dados públicos do CNPJ.
          </p>
          <table className="cnpj-intelligence-print-data-table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Tipo</th>
                <th>Valor no ERP</th>
              </tr>
            </thead>
            <tbody>
              {data.comparison.erpCommercialFields.map((field) => (
                <tr key={field.field}>
                  <td>{field.label}</td>
                  <td>{field.kindLabel}</td>
                  <td>{formatCnpjPrintText(field.erpValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {data.comparison && data.comparison.fields.length > 0 ? (
        <section className="cnpj-intelligence-print-section">
          <h2 className="cnpj-intelligence-print-section-title">Comparação cadastral (ERP × API pública)</h2>
          <p className="cnpj-intelligence-print-note">
            {data.comparison.suggestedUpdates} sugestão(ões) oficial(is) · {data.comparison.equalCount}{" "}
            igual(is) · {data.comparison.differentCount} diferente(s)
          </p>
          <table className="cnpj-intelligence-print-data-table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Tipo</th>
                <th>ERP</th>
                <th>API pública</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.comparison.fields.map((field) => (
                <tr key={field.field}>
                  <td>{field.label}</td>
                  <td>{field.kindLabel}</td>
                  <td>{formatCnpjPrintText(field.erpValue)}</td>
                  <td>{formatCnpjPrintText(field.apiValue)}</td>
                  <td>{CNPJ_COMPARE_STATUS_LABEL[field.status] ?? field.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <footer className="cnpj-intelligence-print-footer cnpj-intelligence-print-section">
        <p>
          Consulta realizada em {formatCnpjPrintDateTime(data.fetchedAt)} · Fonte:{" "}
          {formatCnpjPrintText(data.source)}
          {data.fromCache ? " (cache)" : ""}
        </p>
        <p>IndusCost — Inteligência Comercial · Relatório para apoio à decisão comercial.</p>
      </footer>
    </div>
  );
}
