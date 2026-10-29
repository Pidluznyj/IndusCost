import React, { useEffect, useMemo, useState } from "react";
import {
  FISCAL360_EVIDENCE_LABELS,
  FISCAL360_LINK_STATE_LABELS,
  FISCAL360_PAYMENT_STATUS_LABELS,
  FISCAL360_TAX_LABELS,
  fiscal360CompanyLabel,
  type Fiscal360PaymentStatus,
} from "@/src/lib/finance/fiscal360/fiscal360Constants";
import {
  buildFiscal360Query,
  formatFiscal360Date,
  formatFiscal360DateTime,
  formatFiscal360Month,
  type Fiscal360Capabilities,
  type Fiscal360UiFilters,
} from "@/src/lib/finance/fiscal360/fiscal360Client";
import type { Fiscal360PaymentDetail, Fiscal360PaymentRow, Fiscal360PaymentsResponse } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { Fiscal360DecisionForm, type DecisionTarget } from "./Fiscal360Decisions";
import { Badge, ButtonLike, Callout, DataTable, Drawer, ErrorState, KeyValue, KpiCard, KpiGrid, LoadingState, Pagination, Section, money, statusTone } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

const STATUS_OPTIONS: Array<[string, string]> = [
  ["", "Todas as situações"],
  ["OVERDUE", "Vencidas"],
  ["OPEN", "Em aberto"],
  ["PARTIAL", "Pagamento parcial"],
  ["PAID_PROVEN", "Pagas e comprovadas"],
  ["PAID_ERP", "Baixa no ERP sem comprovante"],
  ["PAID_DECLARED", "Declaradas sem AP/comprovante"],
  ["REVIEW", "Em revisão (fora do total)"],
  ["REVERSED", "Estornadas"],
  ["CANCELLED", "Canceladas"],
  ["INSUFFICIENT_DATA", "Dados insuficientes"],
];

export function paymentStatusLabel(status: string): string {
  return FISCAL360_PAYMENT_STATUS_LABELS[status as Fiscal360PaymentStatus] ?? status;
}

function sourceLabel(r: Fiscal360PaymentRow): string {
  if (r.paidSource === "AP_LINK") return "Baixa Nomus + guia";
  if (r.paidSource === "GUIDE_MANUAL") return "Guia (valor declarado)";
  if (r.paidSource === "AP_TITLE") return "Baixa Nomus (sem guia)";
  return r.linkState === "AP_ONLY" ? "Título AP" : "Guia";
}

export function Fiscal360Payments({
  filters,
  refreshKey,
  caps,
  initialStatus,
  onOpenPayment,
}: {
  filters: Fiscal360UiFilters;
  refreshKey: number;
  caps: Fiscal360Capabilities;
  initialStatus?: string;
  onOpenPayment: (anchorKey: string) => void;
}) {
  const [status, setStatus] = useState(initialStatus ?? "");
  const [evidence, setEvidence] = useState("");
  const [linkState, setLinkState] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters, status, evidence, linkState, q]);
  const query = useMemo(() => buildFiscal360Query(filters, { status, evidenceLevel: evidence, linkState, q, page, pageSize: 50 }), [filters, status, evidence, linkState, q, page]);
  const { data, loading, error } = useFiscal360Resource<Fiscal360PaymentsResponse>("payments", query, refreshKey);
  const select = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  return (
    <div className="space-y-4" data-testid="fiscal360-payments">
      {data ? (
        <KpiGrid>
          <KpiCard label="Pago (contado uma vez)" value={money(data.totals.paidCounted)} source="FiscalPaymentFact.countsInPaidTotals" />
          <KpiCard label="Devido nas obrigações" value={money(data.totals.amountDue)} source="Guia › título AP" />
          <KpiCard label="Saldo em aberto" value={money(data.totals.openBalance)} tone={data.totals.openBalance > 0 ? "warn" : undefined} />
          <KpiCard label="Em revisão (fora do total)" value={money(data.totals.paidInReview)} tone={data.totals.paidInReview > 0 ? "danger" : undefined} hint={`${data.total} obrigação(ões) no filtro`} />
        </KpiGrid>
      ) : null}
      <Section
        title="Razão de pagamentos tributários"
        subtitle="Pagamento no ERP (baixa do AP) é separado do pagamento documentalmente comprovado. Não somar de novo o mesmo título na Tesouraria."
        actions={
          <div className="flex flex-wrap gap-2">
            <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação" data-testid="fiscal360-payments-status">
              {STATUS_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select className={select} value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-label="Evidência">
              <option value="">Toda evidência</option>
              {Object.entries(FISCAL360_EVIDENCE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select className={select} value={linkState} onChange={(e) => setLinkState(e.target.value)} aria-label="Fonte">
              <option value="">Toda fonte</option>
              {Object.entries(FISCAL360_LINK_STATE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input className={`${select} w-40`} placeholder="Guia, código…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          </div>
        }
      >
        {error ? <ErrorState message={error} /> : null}
        {!data && loading ? <LoadingState /> : null}
        {data ? (
          <>
            <DataTable
              testId="fiscal360-payments-table"
              rows={data.rows}
              rowKey={(r) => r.anchorKey}
              onRowClick={(r) => onOpenPayment(r.anchorKey)}
              empty="Nenhuma obrigação materializada neste filtro. Ausência de dados não significa imposto zero."
              columns={[
                { key: "tax", header: "Tributo / empresa", render: (r) => (<><b>{FISCAL360_TAX_LABELS[r.taxType] ?? r.taxType}</b><br /><span className="text-[#6B7280]">{fiscal360CompanyLabel(r.companyCnpj)}</span></>) },
                { key: "comp", header: "Competência", render: (r) => formatFiscal360Month(r.competenceMonth) },
                { key: "guide", header: "Guia / título", render: (r) => (<>{r.guideNumber ?? (r.guideId ? "Guia sem número" : "—")}{r.revenueCode ? <span className="text-[#6B7280]"> · {r.revenueCode}</span> : null}<br /><span className="text-[#6B7280]">{r.apExternalId != null ? `AP Nomus ${r.apExternalId}` : "sem AP"}</span></>) },
                { key: "due", header: "Devido", align: "right", render: (r) => money(r.amountDue) },
                { key: "paid", header: "Pago", align: "right", render: (r) => (<b className={r.countsInPaidTotals ? "" : "text-[#9CA3AF] line-through"} title={r.reviewReason ?? undefined}>{money(r.paidAmount)}</b>) },
                { key: "date", header: "Pagamento / venc.", render: (r) => (<>{r.paidAt ? formatFiscal360Date(r.paidAt) : <span className="text-[#9CA3AF]">sem data de caixa</span>}<br /><span className="text-[#6B7280]">venc. {formatFiscal360Date(r.dueDate)}</span></>) },
                { key: "acc", header: "Conta", render: (r) => r.paymentAccount ?? "—" },
                { key: "ev", header: "Evidência", render: (r) => <span className="text-[11px]">{FISCAL360_EVIDENCE_LABELS[r.evidenceLevel] ?? r.evidenceLevel}</span> },
                { key: "st", header: "Situação", render: (r) => (<Badge tone={r.countsInPaidTotals ? statusTone(r.effectiveStatus) : "danger"}>{r.countsInPaidTotals ? paymentStatusLabel(r.effectiveStatus) : "Em revisão"}</Badge>) },
                { key: "src", header: "Origem", render: (r) => <span className="text-[11px] text-[#4B5563]">{sourceLabel(r)}</span> },
              ]}
            />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        ) : null}
      </Section>
      {!caps.reconcile ? <p className="text-[11px] text-[#6B7280]">Revisões manuais exigem a permissão “Inteligência Fiscal 360° — Conciliar”.</p> : null}
    </div>
  );
}

export function Fiscal360PaymentDrawer({
  anchorKey,
  caps,
  onClose,
  refreshKey,
}: {
  anchorKey: string | null;
  caps: Fiscal360Capabilities;
  onClose: () => void;
  refreshKey: number;
}) {
  const { data, loading, error, reload } = useFiscal360Resource<Fiscal360PaymentDetail>(anchorKey ? "payments/detail" : null, anchorKey ? `anchorKey=${encodeURIComponent(anchorKey)}` : "", refreshKey);
  const [decision, setDecision] = useState<DecisionTarget | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    setDecision(null);
    setDone(null);
  }, [anchorKey]);
  const f = data?.fact;
  const actions: Array<[string, DecisionTarget, boolean]> = f
    ? [
        ["Vincular a título AP", { decisionType: "LINK_GUIDE_AP", guideId: f.guideId }, caps.reconcile && f.linkState === "GUIDE_ONLY"],
        ["Vincular a uma guia", { decisionType: "LINK_GUIDE_AP", apExternalId: f.apExternalId }, caps.reconcile && f.linkState === "AP_ONLY"],
        ["Obrigações distintas", { decisionType: "MARK_DISTINCT", guideId: f.guideId, apExternalId: f.apExternalId }, caps.reconcile && !f.countsInPaidTotals],
        ["Definir empresa da guia", { decisionType: "ASSIGN_GUIDE_COMPANY", guideId: f.guideId }, caps.reconcile && Boolean(f.guideId)],
        ["Não é tributo", { decisionType: "AP_REJECT_TAX", apExternalId: f.apExternalId }, caps.reclassify && f.linkState === "AP_ONLY"],
      ]
    : [];
  return (
    <Drawer open={Boolean(anchorKey)} title={f ? `${FISCAL360_TAX_LABELS[f.taxType] ?? f.taxType} · ${formatFiscal360Month(f.competenceMonth)}` : "Obrigação tributária"} subtitle="Rastreamento: apuração → guia → contas a pagar → baixa → comprovante" onClose={onClose}>
      {error ? <ErrorState message={error} /> : null}
      {!data && loading ? <LoadingState /> : null}
      {f && data ? (
        <>
          <KeyValue
            items={[
              ["Empresa", fiscal360CompanyLabel(f.companyCnpj)],
              ["Situação", <Badge tone={statusTone(f.effectiveStatus)}>{paymentStatusLabel(f.effectiveStatus)}</Badge>],
              ["Valor devido", money(f.amountDue)],
              ["Valor pago", f.countsInPaidTotals ? money(f.paidAmount) : `${money(f.paidAmount)} (em revisão)`],
              ["Juros / multa", `${money(Number(f.interestAmount ?? 0))} / ${money(Number(f.fineAmount ?? 0))}`],
              ["Saldo", money(f.openBalance)],
              ["Vencimento", formatFiscal360Date(f.dueDate)],
              ["Pagamento", f.paidAt ? `${formatFiscal360Date(f.paidAt)} (${f.paidAtSource})` : "sem data de caixa"],
              ["Evidência", FISCAL360_EVIDENCE_LABELS[f.evidenceLevel] ?? f.evidenceLevel],
              ["Vínculo", FISCAL360_LINK_STATE_LABELS[f.linkState] ?? f.linkState],
            ]}
          />
          {f.reviewReason ? <Callout tone="danger">{f.reviewReason}</Callout> : null}
          <Section title="Trilha de evidências">
            <ol className="space-y-3 border-l-2 border-[#DBEAFE] pl-4">
              {data.evidenceTrail.map((s) => (
                <li key={s.step} className="relative">
                  <span className="absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full bg-[#2563EB]" />
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[12px]">{s.step}</b>
                    <Badge tone={s.status === "OK" ? "good" : s.status === "MISSING" ? "danger" : s.status === "REVIEW" ? "warn" : "neutral"}>{s.status === "OK" ? "ok" : s.status === "MISSING" ? "ausente" : s.status === "REVIEW" ? "revisar" : "info"}</Badge>
                  </div>
                  <p className="text-[11px] text-[#4B5563]">{s.detail}</p>
                  <p className="text-[10px] text-[#9CA3AF]">Fonte: {s.source}{s.reference ? ` · ${s.reference}` : ""}</p>
                </li>
              ))}
            </ol>
          </Section>
          {data.treasury.length ? (
            <Section title="Conciliação bancária (Tesouraria)">
              <ul className="space-y-1 text-[12px]">
                {data.treasury.map((t) => (
                  <li key={t.matchId}>{formatFiscal360Date(t.matchedCivilDate)} · {money(t.amount)} · {t.accountName ?? "conta"}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {data.proofs.length ? (
            <Section title="Comprovantes">
              <ul className="space-y-1 text-[12px]">
                {data.proofs.map((p) => (
                  <li key={p.id}>{p.originalFileName} · {formatFiscal360DateTime(p.uploadedAt)} · {p.uploadedBy ?? "—"}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {(caps.reconcile || caps.reclassify) && actions.some((a) => a[2]) ? (
            <Section title="Revisão manual">
              {done ? <Callout>{done}</Callout> : null}
              {decision ? (
                <Fiscal360DecisionForm
                  target={decision}
                  onCancel={() => setDecision(null)}
                  onDone={() => {
                    setDecision(null);
                    setDone("Decisão registrada. O efeito aparecerá após o próximo processamento incremental.");
                    reload();
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {actions.filter((a) => a[2]).map(([label, target]) => (
                    <React.Fragment key={label}>
                      <ButtonLike variant="quiet" onClick={() => setDecision(target)}>
                        {label}
                      </ButtonLike>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </Section>
          ) : null}
          {data.decisions.length ? (
            <Section title="Decisões registradas">
              <ul className="space-y-1 text-[11px]">
                {data.decisions.map((d) => (
                  <li key={d.id} className={d.active ? "" : "text-[#9CA3AF] line-through"}>
                    {formatFiscal360DateTime(d.createdAt)} · {d.createdByName ?? "—"} · {d.decisionType} — {d.reason}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {data.audit.length ? (
            <Section title="Auditoria">
              <ul className="space-y-1 text-[11px] text-[#4B5563]">
                {data.audit.map((a) => (
                  <li key={a.id}>{formatFiscal360DateTime(a.createdAt)} · {a.action} · {a.userName ?? "sistema"}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          <p className="text-[10px] text-[#9CA3AF]">Âncora {f.anchorKey} · materializado em {formatFiscal360DateTime(f.materializedAt)} · regra {String(f.ruleVersion ?? "")}</p>
        </>
      ) : null}
    </Drawer>
  );
}
