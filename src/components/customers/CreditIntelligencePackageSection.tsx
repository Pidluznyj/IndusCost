import React, { useState } from "react";
import { IEPTB_COVERAGE_NOTE, IEPTB_ONLINE_PRODUCT } from "@/src/lib/ieptbOnline/config";
import type { IeptbSections } from "@/src/lib/ieptbOnline/parse";
import { formatCreditDateTime } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { QUOD_DOSSIER_PRODUCT, QUOD_DOSSIER_PROVIDER, QUOD_SCORE_SCALE_NOTE } from "@/src/lib/quodDossier/config";
import { cn } from "@/src/lib/utils";

export type PackageQuoteLineView = {
  product: string;
  action: "CACHE" | "QUERY" | "SKIP";
  billedCents: number;
  note: string;
};

export function CreditExternalDimensions({
  creditLabel,
  cadastralScore,
  quodScore,
  quodState,
  ieptbLabel,
  ieptbState,
}: {
  creditLabel: string;
  cadastralScore: string;
  quodScore: string;
  quodState: string;
  ieptbLabel: string;
  ieptbState: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="credit-intelligence-dimensions">
      <article className="rounded-lg border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">1. Histórico financeiro — Nomus</p>
        <p className="mt-1 text-sm font-semibold">{creditLabel}</p>
        <p className="mt-1 text-[11px] text-slate-500">Decisão interna. Score externo alto não remove bloqueio.</p>
      </article>
      <article className="rounded-lg border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">2. Risco externo — QUOD</p>
        <p className="mt-1 text-sm font-semibold" data-testid="package-header-quod">{quodScore}</p>
        <p className="mt-1 text-[11px] text-slate-500">{quodState === "VALID" ? QUOD_SCORE_SCALE_NOTE : "Não consultado não significa sem restrição."}</p>
      </article>
      <article className="rounded-lg border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">3. Protestos nacionais — IEPTB</p>
        <p className="mt-1 text-sm font-semibold" data-testid="package-header-ieptb">{ieptbLabel}</p>
        <p className="mt-1 text-[11px] text-slate-500">Fonte nacional especializada. Não substitui o protesto interno.</p>
      </article>
      <article className="rounded-lg border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">4. Qualidade cadastral</p>
        <p className="mt-1 text-sm font-semibold" data-testid="package-header-cadastral">{cadastralScore}</p>
        <p className="mt-1 text-[11px] text-slate-500">Consistência cadastral. Não representa aprovação de crédito.</p>
      </article>
    </div>
  );
}

export function PackagePaidConsultationDialog({
  companyName,
  cnpj,
  requestedBy,
  requestedAt,
  quodLine,
  ieptbLine,
  totalLabel,
  forceRefresh,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  companyName: string;
  cnpj: string;
  requestedBy: string;
  requestedAt: string;
  quodLine: PackageQuoteLineView;
  ieptbLine: PackageQuoteLineView;
  totalLabel: string;
  forceRefresh: boolean;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" data-testid="package-paid-dialog">
      <div role="dialog" aria-modal="true" aria-labelledby="package-paid-title" className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
        <h3 id="package-paid-title" className="text-base font-semibold">Confirmar análise completa de risco e crédito</h3>
        <dl className="mt-3 space-y-1 text-sm text-slate-700">
          <div><dt className="inline text-slate-500">Empresa: </dt><dd className="inline">{companyName}</dd></div>
          <div><dt className="inline text-slate-500">CNPJ: </dt><dd className="inline">{cnpj}</dd></div>
          <div><dt className="inline text-slate-500">Fornecedor: </dt><dd className="inline">{QUOD_DOSSIER_PROVIDER}</dd></div>
          <div><dt className="inline text-slate-500">Usuário: </dt><dd className="inline">{requestedBy}</dd></div>
          <div><dt className="inline text-slate-500">Data e hora: </dt><dd className="inline">{requestedAt}</dd></div>
        </dl>
        <ul className="mt-3 space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
          <li>
            <span className="font-medium">{QUOD_DOSSIER_PRODUCT}</span>
            {" — "}
            {quodLine.billedCents === 0 ? "R$ 0,00 (cache)" : (quodLine.note.includes("R$") ? quodLine.note : `R$ ${(quodLine.billedCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)}
            <p className="text-xs text-slate-500">{quodLine.note}</p>
          </li>
          <li>
            <span className="font-medium">{IEPTB_ONLINE_PRODUCT}</span>
            {" — "}
            {ieptbLine.billedCents === 0 ? "R$ 0,00 (cache)" : `R$ ${(ieptbLine.billedCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
            <p className="text-xs text-slate-500">{ieptbLine.note}</p>
          </li>
        </ul>
        <p className="mt-3 text-sm font-semibold" data-testid="package-paid-total">TOTAL PREVISTO: {totalLabel}</p>
        <p className="mt-2 text-sm text-amber-900">
          Esta operação realizará até duas consultas pagas à Direct Data. A cobrança dependerá das condições comerciais contratadas. O sistema registrará os custos e os resultados individualmente.
        </p>
        {forceRefresh ? (
          <p className="mt-2 text-sm text-red-800">Reconsulta antecipada: consultas válidas em cache também serão cobradas de novo, respeitando o intervalo mínimo.</p>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">Abrir esta janela não consulta o provedor.</p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} data-testid="package-paid-consent" />
          <span>Estou ciente dos valores informados e autorizo as consultas pagas selecionadas.</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-40" disabled={submitting} onClick={onCancel}>Cancelar</button>
          <button type="button" className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!accepted || submitting} onClick={onConfirm} data-testid="package-paid-confirm">
            {submitting ? "Consultando…" : "Confirmar análise completa"}
          </button>
        </div>
      </div>
    </div>
  );
}

function money(value: number | null | undefined): string {
  if (value == null) return "não informado";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function IeptbOnlineReport({ sections }: { sections: IeptbSections }) {
  const empty = sections.hasProtests === false && (sections.protestCount ?? 0) === 0;
  return (
    <div className="space-y-3 text-sm" data-testid="ieptb-online-report">
      <section>
        <h4 className="font-semibold">Resumo IEPTB</h4>
        <p>
          {empty
            ? "Nenhum protesto identificado na consulta."
            : sections.hasProtests === true
              ? "Protestos identificados nesta fonte nacional."
              : "A consulta não confirmou cobertura suficiente para concluir ausência de protesto."}
        </p>
        <p>Quantidade: {sections.protestCount == null ? "não informada" : sections.protestCount}</p>
        <p>Valor total: {sections.totalAmountLabel ?? money(sections.totalAmount)}</p>
        <p className="text-xs text-slate-600">{sections.coverageNote || IEPTB_COVERAGE_NOTE}</p>
      </section>
      {sections.states.map((group, index) => (
        <section key={`${group.state}-${index}`} className="rounded border p-2">
          <h5 className="font-medium">{group.state ?? "UF não informada"}</h5>
          <p className="text-xs text-slate-600">
            {group.protestCount ?? 0} ocorrência(s) · {group.totalAmountLabel ?? money(group.totalAmount)}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-2">Cidade</th>
                  <th className="py-1 pr-2">Cartório / qtde</th>
                  <th className="py-1 pr-2">Valor</th>
                  <th className="py-1">Títulos</th>
                </tr>
              </thead>
              <tbody>
                {group.offices.map((office, officeIndex) => (
                  <tr key={`${office.city}-${officeIndex}`} className="border-b align-top">
                    <td className="py-1 pr-2">{office.city ?? "—"}</td>
                    <td className="py-1 pr-2">{office.protestCount ?? "—"}</td>
                    <td className="py-1 pr-2">{office.totalAmountLabel ?? money(office.totalAmount)}</td>
                    <td className="py-1">
                      {office.titles.length === 0
                        ? "—"
                        : office.titles.map((title, titleIndex) => (
                            <p key={`${title.protestedAt}-${titleIndex}`}>
                              {title.protestedAt ?? "data não informada"} · {title.amountLabel ?? money(title.amount)}
                            </p>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function CreditIntelligenceSourceCards({
  quodState,
  quodScore,
  quodAlerts,
  quodConsultedAt,
  quodValidUntil,
  ieptbState,
  ieptbConfirmed,
  ieptbClear,
  ieptbCount,
  ieptbTotal,
  ieptbStates,
  ieptbConsultedAt,
  ieptbValidUntil,
  complete,
  ieptbEnabled,
  canQuery,
  onViewQuod,
  onViewIeptb,
  onRequestPackage,
  onForceRefresh,
}: {
  quodState: string;
  quodScore: number | null;
  quodAlerts: string[];
  quodConsultedAt: string | null;
  quodValidUntil: string | null;
  ieptbState: string;
  ieptbConfirmed: boolean;
  ieptbClear: boolean;
  ieptbCount: number | null;
  ieptbTotal: number | null;
  ieptbStates: string[];
  ieptbConsultedAt: string | null;
  ieptbValidUntil: string | null;
  complete: boolean;
  ieptbEnabled: boolean;
  canQuery: boolean;
  onViewQuod: () => void;
  onViewIeptb: () => void;
  onRequestPackage: () => void;
  onForceRefresh: () => void;
}) {
  return (
    <section className="space-y-3" data-testid="credit-intelligence-package">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Inteligência externa de crédito</h3>
      {!complete ? (
        <p className="text-xs text-amber-800">
          Análise completa indisponível: uma das fontes obrigatórias está ausente ou desatualizada.
        </p>
      ) : (
        <p className="text-xs text-slate-600">Análise completa armazenada. Nova cobrança: R$ 0,00, salvo reconsulta antecipada.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-lg border p-3 text-sm">
          <h4 className="font-semibold">QUOD</h4>
          <p>Score bruto: {quodScore == null ? "não informado" : quodScore}</p>
          <p>Status: {quodState}</p>
          <p>Consulta: {quodConsultedAt ? formatCreditDateTime(quodConsultedAt) : "—"}</p>
          <p>Validade: {quodValidUntil ? formatCreditDateTime(quodValidUntil) : "—"}</p>
          {quodAlerts.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-amber-900">
              {quodAlerts.map((alert) => (
                <li key={alert}>• {alert}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="mt-2 rounded border px-2 py-1 text-xs" onClick={onViewQuod} data-testid="package-view-quod">
            Ver relatório QUOD
          </button>
        </article>
        <article className={cn("rounded-lg border p-3 text-sm", ieptbConfirmed && "border-amber-300 bg-amber-50")}>
          <h4 className="font-semibold">IEPTB — Brasil</h4>
          <p>
            Situação:{" "}
            {ieptbState !== "VALID"
              ? ieptbState === "NOT_CONSULTED"
                ? "Não consultado"
                : ieptbState
              : ieptbConfirmed
                ? "Ocorrência encontrada"
                : ieptbClear
                  ? "Sem ocorrência"
                  : "Informação indisponível ou incompleta"}
          </p>
          <p>Quantidade: {ieptbCount == null ? "não informada" : ieptbCount}</p>
          <p>Valor total: {ieptbTotal == null ? "não informado" : ieptbTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          <p>Estados: {ieptbStates.length === 0 ? "—" : ieptbStates.join(", ")}</p>
          <p>Consulta: {ieptbConsultedAt ? formatCreditDateTime(ieptbConsultedAt) : "—"}</p>
          <p>Validade: {ieptbValidUntil ? formatCreditDateTime(ieptbValidUntil) : "—"}</p>
          <p className="mt-1 text-[11px] text-slate-500">{IEPTB_COVERAGE_NOTE}</p>
          <button type="button" className="mt-2 rounded border px-2 py-1 text-xs" onClick={onViewIeptb} data-testid="package-view-ieptb">
            Ver relatório IEPTB
          </button>
        </article>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-40"
          disabled={!canQuery || !ieptbEnabled}
          onClick={onRequestPackage}
          data-testid="package-request-paid"
        >
          Consultar risco completo — QUOD + Protestos Brasil
        </button>
        {complete ? (
          <button type="button" className="rounded border px-3 py-2 text-xs" onClick={onForceRefresh} data-testid="package-force-refresh">
            Atualizar análise
          </button>
        ) : null}
        {!ieptbEnabled ? (
          <p className="text-xs text-slate-500">Protestos nacionais ainda não habilitados. O dossiê QUOD permanece disponível.</p>
        ) : null}
      </div>
    </section>
  );
}
