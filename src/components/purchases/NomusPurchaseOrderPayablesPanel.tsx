/**
 * Aba Financeiro do Pedido Nomus — reconciliação parcela × título de Contas a Pagar.
 *
 * Tudo que aparece aqui vem pronto do servidor (`/api/nomus/purchase-orders/:id/payables`).
 * O componente só apresenta e dispara confirmação/desvínculo. A baixa do título
 * continua sendo feita no Nomus; a baixa do PEDIDO é derivada dos títulos vinculados.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { OverlayBadge } from "@/src/components/ui/overlay";
import { formatCurrency } from "@/src/lib/utils";
import {
  nomusPurchaseOrderFinancialLabel,
  nomusPurchaseOrderFinancialTone,
} from "@/src/lib/nomus/nomusPurchaseOrderUi";
import type {
  LinkedPayableView,
  PayableLinkSuggestion,
  PurchaseOrderPayableReconciliation,
  ReconciledInstallmentView,
} from "@/src/lib/nomus/nomusPurchaseOrderPayableLink";
import {
  confirmPurchaseOrderPayableLinkRequest,
  fetchPurchaseOrderPayableReconciliation,
  removePurchaseOrderPayableLinkRequest,
} from "@/src/lib/nomus/nomusPurchaseOrderPayableLinkClient";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function money(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value);
}

const PAYABLE_STATUS_TONE: Record<LinkedPayableView["status"], "sky" | "emerald" | "amber" | "rose" | "slate"> = {
  OPEN: "sky",
  OVERDUE: "amber",
  SETTLED: "emerald",
  CANCELLED: "rose",
  SUSPENDED: "slate",
};

const INSTALLMENT_STATUS_TONE: Record<ReconciledInstallmentView["status"], "sky" | "emerald" | "amber" | "slate"> = {
  UNLINKED: "slate",
  LINKED: "sky",
  PARTIALLY_PAID: "amber",
  PAID: "emerald",
};

function SummaryCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{value}</div>
      {hint ? <p className="text-[10px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export type NomusPurchaseOrderPayablesPanelViewProps = {
  data: PurchaseOrderPayableReconciliation | null;
  loading: boolean;
  error: string | null;
  busyKey: string | null;
  actionError: string | null;
  canLink: boolean;
  onRefresh: () => void;
  onConfirmSuggestion: (suggestion: PayableLinkSuggestion) => void;
  onUnlink: (payable: LinkedPayableView) => void;
  onManualLink: (input: { payableExternalId: number; installmentIndex: number | null; reason: string }) => void;
};

function LinkedPayableRow({
  payable,
  canLink,
  busy,
  onUnlink,
}: {
  payable: LinkedPayableView;
  canLink: boolean;
  busy: boolean;
  onUnlink: (payable: LinkedPayableView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid={`npo-linked-payable-${payable.payableExternalId}`}>
      <span className="font-mono">#{payable.payableExternalId}</span>
      <OverlayBadge tone={PAYABLE_STATUS_TONE[payable.status]}>{payable.statusLabel}</OverlayBadge>
      <span title={payable.evidence ?? undefined} className="text-slate-500">
        {payable.methodLabel}
        {payable.confidence === "CONFIRMED" && payable.linkedByUserName ? ` · ${payable.linkedByUserName}` : ""}
      </span>
      <span className="tabular-nums">{money(payable.amountPayable)}</span>
      <span className="text-slate-500">pago {money(payable.realizedAmount)}</span>
      {payable.settlementDate || payable.paymentDate ? (
        <span className="text-slate-500">baixa {formatDate(payable.settlementDate ?? payable.paymentDate)}</span>
      ) : null}
      {payable.linkedToOtherOrder ? (
        <OverlayBadge tone="amber" title="Este título também está vinculado a outro pedido.">Em outro pedido</OverlayBadge>
      ) : null}
      {canLink && payable.linkId ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUnlink(payable)}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          data-testid={`npo-unlink-${payable.payableExternalId}`}
        >
          <Link2Off className="h-3 w-3" /> Desvincular
        </button>
      ) : null}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  canLink,
  busy,
  onConfirm,
}: {
  suggestion: PayableLinkSuggestion;
  canLink: boolean;
  busy: boolean;
  onConfirm: (suggestion: PayableLinkSuggestion) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
      data-testid={`npo-suggestion-${suggestion.payableExternalId}`}
    >
      <span className="font-mono">#{suggestion.payableExternalId}</span>
      <span>Sugestão — {suggestion.evidence}</span>
      {suggestion.linkedToOtherOrder ? <OverlayBadge tone="amber">Em outro pedido</OverlayBadge> : null}
      {canLink ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(suggestion)}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
          data-testid={`npo-confirm-suggestion-${suggestion.payableExternalId}`}
        >
          <CheckCircle2 className="h-3 w-3" /> Confirmar vínculo
        </button>
      ) : (
        <span className="text-[11px]">Confirmação exige permissão de edição em Compras.</span>
      )}
    </div>
  );
}

export function NomusPurchaseOrderPayablesPanelView({
  data,
  loading,
  error,
  busyKey,
  actionError,
  canLink,
  onRefresh,
  onConfirmSuggestion,
  onUnlink,
  onManualLink,
}: NomusPurchaseOrderPayablesPanelViewProps) {
  const [manualPayable, setManualPayable] = useState("");
  const [manualInstallment, setManualInstallment] = useState("");
  const [manualReason, setManualReason] = useState("");
  const busy = busyKey != null;

  return (
    <section className="space-y-4" data-testid="npo-payables-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Contas a Pagar vinculadas</h2>
          <p className="text-xs text-slate-500">
            Vínculo automático por NF-e, documento de entrada ou número do pedido no título; parcela × título
            só com confirmação humana. A baixa é do Nomus — o pedido fica quitado quando todos os títulos
            vinculados estiverem baixados.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
          data-testid="npo-payables-refresh"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="npo-payables-error">{error}</p>
      ) : null}
      {actionError ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="npo-payables-action-error">{actionError}</p>
      ) : null}
      {loading && !data ? (
        <p className="flex items-center gap-2 text-sm text-slate-500" data-testid="npo-payables-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando títulos…
        </p>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="Planejado" value={money(data.totals.plannedAmount)} hint={`${data.totals.plannedCount} parcela(s)`} />
            <SummaryCard label="Vinculado" value={money(data.totals.linkedAmount)} hint={`${data.totals.linkedCount} título(s)`} />
            <SummaryCard label="Pago" value={money(data.totals.paidAmount)} />
            <SummaryCard label="Saldo" value={money(data.totals.openAmount)} />
            <SummaryCard label="Parcelas sem título" value={String(data.totals.unlinkedInstallmentCount)} hint={data.totals.suggestionCount > 0 ? `${data.totals.suggestionCount} sugestão(ões)` : undefined} />
            <SummaryCard
              label="Situação do pedido"
              value={
                <OverlayBadge tone={nomusPurchaseOrderFinancialTone(data.financialStatus)} testId="npo-payables-status">
                  {data.fullySettled ? "Quitado" : nomusPurchaseOrderFinancialLabel(data.financialStatus)}
                </OverlayBadge>
              }
            />
          </div>

          {data.warnings.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="npo-payables-warnings">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <table className="min-w-full text-xs" data-testid="npo-payables-installments">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Parcela</th>
                <th className="px-2 py-2">Vencimento</th>
                <th className="px-2 py-2">Valor</th>
                <th className="px-2 py-2">Situação</th>
                <th className="px-2 py-2">Título(s) de Contas a Pagar</th>
              </tr>
            </thead>
            <tbody>
              {data.installments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-slate-500">
                    O pedido não traz parcelas planejadas.
                  </td>
                </tr>
              ) : (
                data.installments.map((installment) => (
                  <tr key={installment.index} className="border-t border-slate-100 align-top" data-testid={`npo-installment-${installment.index}`}>
                    <td className="px-2 py-2">{installment.index + 1}</td>
                    <td className="px-2 py-2">{installment.dueDate ? formatDate(installment.dueDate) : installment.dueDateRaw ?? "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{money(installment.amount)}</td>
                    <td className="px-2 py-2">
                      <OverlayBadge tone={INSTALLMENT_STATUS_TONE[installment.status]}>{installment.statusLabel}</OverlayBadge>
                    </td>
                    <td className="px-2 py-2">
                      <div className="space-y-1">
                        {installment.payables.map((payable) => (
                          <React.Fragment key={payable.payableExternalId}>
                            <LinkedPayableRow payable={payable} canLink={canLink} busy={busy} onUnlink={onUnlink} />
                          </React.Fragment>
                        ))}
                        {installment.suggestions.map((suggestion) => (
                          <React.Fragment key={suggestion.payableExternalId}>
                            <SuggestionRow suggestion={suggestion} canLink={canLink} busy={busy} onConfirm={onConfirmSuggestion} />
                          </React.Fragment>
                        ))}
                        {installment.payables.length === 0 && installment.suggestions.length === 0 ? (
                          <span className="text-slate-400">Nenhum título vinculado nem sugestão.</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {data.unassignedPayables.length > 0 ? (
            <div className="space-y-1" data-testid="npo-payables-unassigned">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Títulos vinculados ao pedido (sem parcela específica)
              </h3>
              {data.unassignedPayables.map((payable) => (
                <React.Fragment key={payable.payableExternalId}>
                            <LinkedPayableRow payable={payable} canLink={canLink} busy={busy} onUnlink={onUnlink} />
                          </React.Fragment>
              ))}
            </div>
          ) : null}

          {canLink ? (
            <form
              className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-3"
              data-testid="npo-manual-link-form"
              onSubmit={(event) => {
                event.preventDefault();
                const payableExternalId = Number.parseInt(manualPayable.trim(), 10);
                if (!Number.isInteger(payableExternalId) || payableExternalId <= 0) return;
                onManualLink({
                  payableExternalId,
                  installmentIndex: manualInstallment === "" ? null : Number(manualInstallment),
                  reason: manualReason.trim(),
                });
                setManualPayable("");
                setManualReason("");
                setManualInstallment("");
              }}
            >
              <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                Nº do título (Contas a Pagar)
                <input value={manualPayable} onChange={(e) => setManualPayable(e.target.value)} inputMode="numeric" className="w-36 rounded border border-slate-300 px-2 py-1 text-sm" data-testid="npo-manual-payable" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                Parcela
                <select value={manualInstallment} onChange={(e) => setManualInstallment(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" data-testid="npo-manual-installment">
                  <option value="">Sem parcela</option>
                  {data.installments.map((row) => (
                    <option key={row.index} value={row.index}>Parcela {row.index + 1}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px] text-slate-500">
                Motivo (obrigatório)
                <input value={manualReason} onChange={(e) => setManualReason(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="Ex.: título emitido sem NF-e; conferido com o fornecedor" data-testid="npo-manual-reason" />
              </label>
              <button
                type="submit"
                disabled={busy || !manualPayable.trim() || !manualReason.trim()}
                className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                data-testid="npo-manual-submit"
              >
                <Link2 className="h-3.5 w-3.5" /> Vincular manualmente
              </button>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function NomusPurchaseOrderPayablesPanel({
  orderId,
  canLink,
  onChanged,
}: {
  orderId: string;
  canLink: boolean;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<PurchaseOrderPayableReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchPurchaseOrderPayableReconciliation(orderId, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar os títulos do pedido.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [orderId, reloadToken]);

  const run = useCallback(
    async (key: string, action: () => Promise<PurchaseOrderPayableReconciliation>) => {
      setBusyKey(key);
      setActionError(null);
      try {
        const payload = await action();
        setData(payload);
        onChanged?.();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Falha ao atualizar o vínculo.");
      } finally {
        setBusyKey(null);
      }
    },
    [onChanged]
  );

  const handlers = useMemo(
    () => ({
      onRefresh: () => setReloadToken((token) => token + 1),
      onConfirmSuggestion: (suggestion: PayableLinkSuggestion) =>
        void run(`confirm-${suggestion.payableExternalId}`, () =>
          confirmPurchaseOrderPayableLinkRequest(orderId, {
            payableExternalId: suggestion.payableExternalId,
            installmentIndex: suggestion.installmentIndex,
            method: "INSTALLMENT_MATCH",
            reason: null,
          })
        ),
      onUnlink: (payable: LinkedPayableView) => {
        const reason = window.prompt("Motivo do desvínculo (obrigatório):", "");
        if (!reason || !reason.trim()) return;
        void run(`unlink-${payable.payableExternalId}`, () =>
          removePurchaseOrderPayableLinkRequest(orderId, payable.payableExternalId, reason.trim())
        );
      },
      onManualLink: (input: { payableExternalId: number; installmentIndex: number | null; reason: string }) =>
        void run(`manual-${input.payableExternalId}`, () =>
          confirmPurchaseOrderPayableLinkRequest(orderId, {
            payableExternalId: input.payableExternalId,
            installmentIndex: input.installmentIndex,
            method: "MANUAL",
            reason: input.reason,
          })
        ),
    }),
    [orderId, run]
  );

  return (
    <NomusPurchaseOrderPayablesPanelView
      data={data}
      loading={loading}
      error={error}
      busyKey={busyKey}
      actionError={actionError}
      canLink={canLink}
      {...handlers}
    />
  );
}
