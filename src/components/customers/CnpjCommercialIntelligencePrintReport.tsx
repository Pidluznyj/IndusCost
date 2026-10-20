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

      <section className="cnpj-intelligence-print-section" data-testid="cnpj-print-credit">
        <h2 className="cnpj-intelligence-print-section-title">Decisão de crédito</h2>
        <p className="cnpj-intelligence-print-blocked">
          {data.creditState === "error"
            ? "CRÉDITO NÃO DETERMINADO"
            : data.credit?.decisionTitle ?? "CRÉDITO NÃO DETERMINADO"}
        </p>
        <p>
          {data.creditState === "loading"
            ? "Situação de crédito ainda carregando."
            : data.creditState === "error"
              ? "Situação de crédito indisponível."
              : data.creditState === "not_consulted" || !data.credit
                ? "Situação de crédito não consultada."
                : data.credit.decisionDescription}
        </p>
        {data.credit && data.credit.decisionReasons.length > 0 ? (
          <table className="cnpj-intelligence-print-data-table">
            <thead>
              <tr>
                <th>Motivo</th>
                <th>Gravidade</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody>
              {data.credit.decisionReasons.map((reason) => (
                <tr key={reason.code}>
                  <td>{formatCnpjPrintText(`${reason.label}. ${reason.description}`)}</td>
                  <td>{reason.severity}</td>
                  <td>{formatCnpjPrintText(reason.origin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {data.credit ? (
          <table className="cnpj-intelligence-print-kv-table">
            <tbody>
              <tr>
                <th>Valor vencido</th>
                <td>{data.credit.overdueAmountLabel}</td>
                <th>Títulos</th>
                <td>{data.credit.overdueTitleCountLabel}</td>
              </tr>
              <tr>
                <th>Maior atraso</th>
                <td>{data.credit.maxDaysOverdueLabel}</td>
                <th>Protesto interno</th>
                <td>{data.credit.internalProtestLabel}</td>
              </tr>
              <tr>
                <th>Sincronização Nomus</th>
                <td>{data.credit.lastSyncedAtLabel}</td>
                <th>Protesto externo</th>
                <td>{data.credit.externalProtestLabel}</td>
              </tr>
              <tr>
                <th>Banco Central</th>
                <td colSpan={3}>{data.credit.bcbDetail}</td>
              </tr>
              <tr>
                <th>Motivo</th>
                <td colSpan={3}>{formatCnpjPrintText(data.credit.blockReason ?? data.credit.reason)}</td>
              </tr>
              <tr>
                <th>Origem</th>
                <td colSpan={3}>{data.credit.evidenceOrigin}</td>
              </tr>
              {data.credit.corporateRelations.length > 0 ? (
                <tr>
                  <th>Vínculos</th>
                  <td colSpan={3}>
                    {data.credit.corporateRelations.map((relation) => (
                      <p key={`${relation.kindLabel}-${relation.relatedCompany}`}>
                        {formatCnpjPrintText(
                          `${relation.kindLabel} · ${relation.relatedCompany} · ${relation.creditStatusLabel}. ${relation.evidence}`
                        )}
                      </p>
                    ))}
                  </td>
                </tr>
              ) : null}
              {data.credit.occurrenceLines.length > 0 ? (
                <tr>
                  <th>Ocorrências</th>
                  <td colSpan={3}>
                    {data.credit.occurrenceLines.map((line) => (
                      <p key={line}>{formatCnpjPrintText(line)}</p>
                    ))}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <p className="cnpj-intelligence-print-note">{data.credit?.bcbDetail ?? "Banco Central: não aplicável. Nenhuma consulta foi realizada."}</p>
        )}
      </section>

      <section className="cnpj-intelligence-print-section cnpj-intelligence-print-risk">
        <h2 className="cnpj-intelligence-print-section-title">Qualidade cadastral</h2>
        <p className="cnpj-intelligence-print-lead">
          Score cadastral: {formatCnpjPrintScore(data.risk.score)}
        </p>
        <p className="cnpj-intelligence-print-note">
          Indicador de consistência e características cadastrais. Não autoriza crédito nem venda a prazo.
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
