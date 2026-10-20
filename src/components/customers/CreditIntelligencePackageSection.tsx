import React, { useState } from "react";
import { IEPTB_COVERAGE_NOTE, IEPTB_ONLINE_PRODUCT } from "@/src/lib/ieptbOnline/config";
import type { IeptbSections } from "@/src/lib/ieptbOnline/parse";
import { formatCreditDateTime } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { QUOD_DOSSIER_PRODUCT, QUOD_DOSSIER_PROVIDER } from "@/src/lib/quodDossier/config";
import { cn } from "@/src/lib/utils";

export type PackageQuoteLineView = {
  product: string;
  action: "CACHE" | "QUERY" | "SKIP";
  billedCents: number;
  note: string;
};

function kpiTone(kind: "blocked" | "alert" | "info" | "neutral"): string {
  if (kind === "blocked") return "border-red-200 bg-red-50 text-red-950 border-l-red-600";
  if (kind === "alert") return "border-amber-200 bg-amber-50 text-amber-950 border-l-amber-500";
  if (kind === "info") return "border-sky-200 bg-sky-50 text-sky-950 border-l-sky-600";
  return "border-slate-200 bg-white text-slate-900 border-l-slate-400";
}

function nomusTone(label: string): "blocked" | "alert" | "info" | "neutral" {
  const value = label.toLowerCase();
  if (value.includes("crítico") || value.includes("critico") || value.includes("bloque")) return "blocked";
  if (value.includes("análise") || value.includes("analise")) return "alert";
  if (value.includes("liberado")) return "info";
  return "neutral";
}

export function CreditExternalDimensions({
  creditLabel,
  cadastralScore,
  quodScore,
  quodState,
  ieptbLabel,
  ieptbState,
  ieptbCount,
}: {
  creditLabel: string;
  cadastralScore: string;
  quodScore: string;
  quodState: string;
  ieptbLabel: string;
  ieptbState: string;
  ieptbCount?: number | null;
}) {
  const ieptbAlert = ieptbLabel.toLowerCase().includes("ocorrência") || ieptbLabel.toLowerCase().includes("ocorrencia");
  const ieptbValue =
    ieptbAlert && ieptbCount != null ? `${ieptbCount} · ${ieptbLabel}` : ieptbLabel;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="credit-intelligence-dimensions">
      <article className={cn("rounded-xl border border-l-4 p-3 shadow-sm", kpiTone(nomusTone(creditLabel)))}>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">1. Histórico financeiro — Nomus</p>
        <p className="mt-1 text-xl font-extrabold leading-tight">{creditLabel}</p>
        <p className="mt-1 text-[11px] opacity-80">Decisão interna. Score externo alto não remove bloqueio.</p>
      </article>
      <article className={cn("rounded-xl border border-l-4 p-3 shadow-sm", kpiTone(quodState === "VALID" ? "info" : "neutral"))}>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">2. Risco externo — QUOD</p>
        <p className="mt-1 text-xl font-extrabold leading-tight" data-testid="package-header-quod">{quodScore}</p>
        <p className="mt-1 text-[11px] opacity-80">{quodState === "VALID" ? "Score bruto. Escala não confirmada; não converte para 0–100." : "Não consultado não significa sem restrição."}</p>
      </article>
      <article className={cn("rounded-xl border border-l-4 p-3 shadow-sm", kpiTone(ieptbAlert ? "alert" : "neutral"))}>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">3. Protestos nacionais — IEPTB</p>
        <p className="mt-1 text-xl font-extrabold leading-tight" data-testid="package-header-ieptb">{ieptbValue}</p>
        <p className="mt-1 text-[11px] opacity-80">Fonte nacional especializada. Não substitui o protesto interno.</p>
      </article>
      <article className={cn("rounded-xl border border-l-4 p-3 shadow-sm", kpiTone("neutral"))}>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">4. Qualidade cadastral</p>
        <p className="mt-1 text-xl font-extrabold leading-tight" data-testid="package-header-cadastral">{cadastralScore}</p>
        <p className="mt-1 text-[11px] opacity-80">Consistência cadastral. Não representa aprovação de crédito.</p>
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
  const titleRows = sections.states.flatMap((group, groupIndex) =>
    group.offices.flatMap((office, officeIndex) => {
      if (office.titles.length === 0) {
        return [
          {
            key: `${group.state}-${office.city}-${groupIndex}-${officeIndex}`,
            state: group.state,
            city: office.city,
            date: null as string | null,
            amount: office.totalAmountLabel ?? money(office.totalAmount),
            document: null as string | null,
          },
        ];
      }
      return office.titles.map((title, titleIndex) => ({
        key: `${group.state}-${office.city}-${title.protestedAt}-${titleIndex}`,
        state: group.state,
        city: office.city,
        date: title.protestedAt,
        amount: title.amountLabel ?? money(title.amount),
        document: title.document,
      }));
    })
  );
  return (
    <div className="space-y-3 text-sm" data-testid="ieptb-online-report">
      <div className={cn("grid gap-2 sm:grid-cols-3", empty ? "text-slate-700" : "text-amber-950")}>
        <div className={cn("rounded-lg border p-3", empty ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50")}>
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Situação</p>
          <p className="mt-1 font-extrabold">
            {empty
              ? "Nenhum protesto identificado na consulta."
              : sections.hasProtests === true
                ? "Protestos identificados nesta fonte nacional."
                : "Informação indisponível ou incompleta"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Quantidade</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{sections.protestCount == null ? "—" : sections.protestCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor total</p>
          <p className="mt-1 text-lg font-extrabold text-slate-900">{sections.totalAmountLabel ?? money(sections.totalAmount)}</p>
        </div>
      </div>
      <p className="text-xs text-slate-600">{sections.coverageNote || IEPTB_COVERAGE_NOTE}</p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">UF</th>
                <th className="px-3 py-2">Cidade</th>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Documento</th>
              </tr>
            </thead>
            <tbody>
              {titleRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={5}>
                    Sem títulos detalhados neste retorno.
                  </td>
                </tr>
              ) : (
                titleRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/70">
                    <td className="px-3 py-1.5 font-semibold">{row.state ?? "—"}</td>
                    <td className="px-3 py-1.5">{row.city ?? "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{row.date ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{row.amount}</td>
                    <td className="px-3 py-1.5 text-slate-600">{row.document ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
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
  const ieptbSituation =
    ieptbState !== "VALID"
      ? ieptbState === "NOT_CONSULTED"
        ? "Não consultado"
        : ieptbState
      : ieptbConfirmed
        ? "Ocorrência encontrada"
        : ieptbClear
          ? "Sem ocorrência"
          : "Informação indisponível ou incompleta";
  return (
    <section className="space-y-3" data-testid="credit-intelligence-package">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Inteligência externa de crédito</h3>
          {!complete ? (
            <p className="text-xs text-amber-800">
              Análise completa indisponível: uma das fontes obrigatórias está ausente ou desatualizada.
            </p>
          ) : (
            <p className="text-xs text-slate-600">Análise completa armazenada. Nova cobrança: R$ 0,00, salvo reconsulta antecipada.</p>
          )}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-xl border border-l-4 border-slate-200 border-l-sky-600 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-800">QUOD</h4>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-800">{quodState}</span>
          </div>
          <p className="mt-2 text-3xl font-extrabold tabular-nums text-slate-900">{quodScore == null ? "—" : quodScore}</p>
          <p className="text-[11px] text-slate-500">Score bruto · escala não confirmada</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div><dt className="text-slate-400">Consulta</dt><dd>{quodConsultedAt ? formatCreditDateTime(quodConsultedAt) : "—"}</dd></div>
            <div><dt className="text-slate-400">Validade</dt><dd>{quodValidUntil ? formatCreditDateTime(quodValidUntil) : "—"}</dd></div>
          </dl>
          {quodAlerts.length > 0 ? (
            <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
              {quodAlerts.map((alert) => (
                <li key={alert} className="flex gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  <span>{alert}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="mt-3 rounded border px-2 py-1 text-xs" onClick={onViewQuod} data-testid="package-view-quod">
            Ver relatório QUOD
          </button>
        </article>
        <article className={cn("rounded-xl border border-l-4 p-4 text-sm shadow-sm", ieptbConfirmed ? "border-amber-200 border-l-amber-500 bg-amber-50" : "border-slate-200 border-l-slate-500 bg-white")}>
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider">IEPTB — Brasil</h4>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", ieptbConfirmed ? "bg-amber-200 text-amber-950" : "bg-slate-100 text-slate-700")}>
              {ieptbSituation}
            </span>
          </div>
          <p className="mt-2 text-3xl font-extrabold tabular-nums">{ieptbCount == null ? "—" : ieptbCount}</p>
          <p className="text-[11px] opacity-80">Quantidade de ocorrências nesta fonte</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="opacity-60">Valor total</dt><dd className="font-semibold">{ieptbTotal == null ? "não informado" : ieptbTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</dd></div>
            <div><dt className="opacity-60">Estados</dt><dd className="font-semibold">{ieptbStates.length === 0 ? "—" : ieptbStates.join(", ")}</dd></div>
            <div><dt className="opacity-60">Consulta</dt><dd>{ieptbConsultedAt ? formatCreditDateTime(ieptbConsultedAt) : "—"}</dd></div>
            <div><dt className="opacity-60">Validade</dt><dd>{ieptbValidUntil ? formatCreditDateTime(ieptbValidUntil) : "—"}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] opacity-70">{IEPTB_COVERAGE_NOTE}</p>
          <button type="button" className="mt-3 rounded border bg-white px-2 py-1 text-xs" onClick={onViewIeptb} data-testid="package-view-ieptb">
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
