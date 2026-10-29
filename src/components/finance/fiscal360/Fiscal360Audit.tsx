import React, { useEffect, useMemo, useState } from "react";
import { fiscal360CompanyLabel } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { buildFiscal360Query, formatFiscal360DateTime, formatFiscal360Month, postFiscal360, type Fiscal360Capabilities, type Fiscal360UiFilters } from "@/src/lib/finance/fiscal360/fiscal360Client";
import type { Fiscal360AuditRow, Fiscal360DecisionRow, Fiscal360IssueRow, Fiscal360Page } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { Badge, ButtonLike, Callout, DataTable, ErrorState, KpiCard, KpiGrid, LoadingState, Pagination, Section, statusTone } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

const ISSUE_LABELS: Record<string, string> = {
  XML_NOT_PARSED: "NF-e sem XML processado",
  XML_MISSING: "NF-e sem XML",
  XML_PARTIAL: "XML parcial",
  NO_HEADER_TAXES: "NF-e sem tributos destacados",
  COMPANY_UNKNOWN: "Emitente fora do grupo",
  NO_COMPETENCE_DATE: "Documento sem data",
  BONIFICATION_IN_OFFICIAL_BILLING: "Bonificação no faturamento oficial",
  INTERCOMPANY_RECIPIENT_NOT_RESOLVED: "Intercompany sem destinatário",
  AP_PENDING_CLASSIFICATION: "Título AP pendente de classificação",
  GUIDE_COMPANY_UNKNOWN: "Guia sem empresa",
  AP_COMPANY_UNKNOWN: "Título sem empresa pagadora",
  DUPLICATE_AP_LINK: "Título vinculado a duas guias",
  POSSIBLE_DUPLICATE: "Possível pagamento duplicado",
  APURATION_VS_GUIDE: "Apuração × guia divergente",
  NO_CASH_DATE: "Pagamento sem data de caixa",
  SETTLED_WITHOUT_CASH: "Baixa sem numerário",
  GUIDE_PAID_DIFFERS_FROM_AP: "Pago na guia ≠ baixa do AP",
  AP_COMPANY_DIFFERS_FROM_PERIOD: "Empresa do AP ≠ período",
  AP_CANCELLED: "Guia com AP cancelado",
  AP_REMOVED_AT_SOURCE: "Guia com AP removido na origem",
};

export function Fiscal360Audit({ filters, refreshKey, caps }: { filters: Fiscal360UiFilters; refreshKey: number; caps: Fiscal360Capabilities }) {
  const [issueType, setIssueType] = useState("");
  const [issueStatus, setIssueStatus] = useState("OPEN");
  const [page, setPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setPage(1), [filters, issueType, issueStatus]);
  const query = useMemo(() => buildFiscal360Query(filters, { issueType, issueStatus, page, pageSize: 50 }), [filters, issueType, issueStatus, page]);
  const issues = useFiscal360Resource<Fiscal360Page<Fiscal360IssueRow> & { summary: Array<{ issueType: string; severity: string; count: number }> }>("issues", query, refreshKey);
  const audit = useFiscal360Resource<Fiscal360Page<Fiscal360AuditRow>>("audit", `page=${auditPage}&pageSize=25`, refreshKey);
  const decisions = useFiscal360Resource<Fiscal360Page<Fiscal360DecisionRow>>("decisions", "page=1&pageSize=50&active=0", refreshKey);
  const summary = issues.data?.summary ?? [];
  const count = (sev: string) => summary.filter((s) => s.severity === sev).reduce((a, s) => a + s.count, 0);
  const select = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";

  async function revoke(d: Fiscal360DecisionRow) {
    const reason = window.prompt("Motivo da revogação (mínimo 10 caracteres):");
    if (!reason) return;
    try {
      await postFiscal360(`decisions/${d.id}/revoke`, { reason });
      setMsg("Decisão revogada; o processamento incremental reavaliará os itens afetados.");
      decisions.reload();
      audit.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Falha ao revogar.");
    }
  }

  return (
    <div className="space-y-4" data-testid="fiscal360-audit">
      <KpiGrid>
        <KpiCard label="Críticas" value={count("CRITICAL")} tone={count("CRITICAL") ? "danger" : "good"} hint="Duplicidades e vínculos duplicados" />
        <KpiCard label="Alertas" value={count("WARNING")} tone={count("WARNING") ? "warn" : undefined} hint="Classificação, XML, empresa, divergências" />
        <KpiCard label="Informativas" value={count("INFO")} hint="Ex.: pagamento sem data de caixa" />
        <KpiCard label="Decisões manuais" value={decisions.data?.total ?? 0} hint="Ativas e revogadas, com motivo" />
      </KpiGrid>
      {msg ? <Callout>{msg}</Callout> : null}
      <Section
        title="Fila de exceções e qualidade de dados"
        subtitle="Sem dados ≠ imposto zero. Pendências são resolvidas automaticamente quando a condição deixa de existir; o histórico é preservado."
        actions={
          <div className="flex flex-wrap gap-2">
            <select className={select} value={issueType} onChange={(e) => setIssueType(e.target.value)} aria-label="Tipo">
              <option value="">Todos os tipos</option>
              {Object.entries(ISSUE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select className={select} value={issueStatus} onChange={(e) => setIssueStatus(e.target.value)} aria-label="Situação">
              <option value="OPEN">Abertas</option>
              <option value="ACKNOWLEDGED">Reconhecidas</option>
              <option value="RESOLVED">Resolvidas (histórico)</option>
            </select>
          </div>
        }
      >
        {issues.error ? <ErrorState message={issues.error} /> : null}
        {!issues.data && issues.loading ? <LoadingState /> : null}
        {issues.data ? (
          <>
            <DataTable
              testId="fiscal360-issues"
              rows={issues.data.rows}
              rowKey={(r) => r.id}
              empty="Nenhuma pendência no filtro."
              columns={[
                { key: "t", header: "Pendência", render: (r) => (<><b>{ISSUE_LABELS[r.issueType] ?? r.issueType}</b><br /><span className="text-[11px] text-[#6B7280]">{r.message}</span></>) },
                { key: "s", header: "Severidade", render: (r) => <Badge tone={statusTone(r.severity)}>{r.severity}</Badge> },
                { key: "e", header: "Empresa", render: (r) => (r.companyCnpj ? fiscal360CompanyLabel(r.companyCnpj) : "—") },
                { key: "m", header: "Competência", render: (r) => formatFiscal360Month(r.competenceMonth) },
                { key: "o", header: "Origem", render: (r) => <span className="text-[11px]">{r.entityType} {r.entityId.slice(0, 18)}</span> },
                { key: "d", header: "Detectada", render: (r) => `${formatFiscal360DateTime(r.firstDetectedAt)}${r.resolvedAt ? ` · resolvida ${formatFiscal360DateTime(r.resolvedAt)}` : ""}` },
              ]}
            />
            <Pagination page={issues.data.page} pageSize={issues.data.pageSize} total={issues.data.total} onPage={setPage} />
          </>
        ) : null}
      </Section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Revisões manuais" subtitle="Usuário, data, motivo e evidência — revogáveis com trilha.">
          <DataTable
            rows={decisions.data?.rows ?? []}
            rowKey={(d) => d.id}
            empty="Nenhuma decisão manual registrada."
            columns={[
              { key: "d", header: "Decisão", render: (d) => (<><b className={d.active ? "" : "line-through"}>{d.decisionType}</b><br /><span className="text-[11px] text-[#6B7280]">{d.reason}</span></>) },
              { key: "a", header: "Alvo", render: (d) => <span className="text-[11px]">{d.guideId ? `guia ${d.guideId.slice(0, 8)}` : ""} {d.apExternalId != null ? `AP ${d.apExternalId}` : ""} {d.itemKey ? "item" : ""}</span> },
              { key: "u", header: "Por", render: (d) => `${d.createdByName ?? "—"} · ${formatFiscal360DateTime(d.createdAt)}` },
              {
                key: "x",
                header: "",
                render: (d) =>
                  d.active && (caps.reconcile || caps.reclassify) ? (
                    <ButtonLike variant="danger" onClick={() => revoke(d)}>
                      Revogar
                    </ButtonLike>
                  ) : d.active ? null : (
                    <Badge tone="neutral">revogada</Badge>
                  ),
              },
            ]}
          />
        </Section>
        <Section title="Trilha de auditoria" subtitle="Classificações automáticas alteradas, decisões, reprocessamentos, regras, cenários e jobs.">
          {audit.data ? (
            <>
              <DataTable
                testId="fiscal360-audit-log"
                rows={audit.data.rows}
                rowKey={(a) => a.id}
                empty="Sem eventos de auditoria."
                columns={[
                  { key: "w", header: "Quando", render: (a) => formatFiscal360DateTime(a.createdAt) },
                  { key: "a", header: "Ação", render: (a) => <b className="text-[11px]">{a.action}</b> },
                  { key: "e", header: "Entidade", render: (a) => <span className="text-[11px]">{a.entityType} {a.entityId.slice(0, 16)}</span> },
                  { key: "u", header: "Usuário", render: (a) => a.userName ?? "sistema" },
                ]}
              />
              <Pagination page={audit.data.page} pageSize={audit.data.pageSize} total={audit.data.total} onPage={setAuditPage} />
            </>
          ) : audit.loading ? (
            <LoadingState />
          ) : null}
        </Section>
      </div>
    </div>
  );
}
