import React, { useState } from "react";
import { AlertTriangle, Check, Loader2, Receipt, Send, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchOk } from "@/src/lib/http";
import type { MaterialMarketQuoteApiItem } from "@/src/lib/materialMarketQuote";
import {
  canApproveMaterialMarketQuote,
  canShowApproveRejectActions,
  canShowSetOfficialAction,
  canShowSubmitForApprovalAction,
  type MaterialMarketQuoteOfficialStatus,
} from "@/src/lib/materialMarketQuote";
import {
  formatMaterialIntelligenceQuoteDate,
  MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE,
} from "@/src/lib/materialIntelligence360Sections";
import type { MaterialMarketCriticality } from "@/src/lib/materialMarketMonitoring";
import {
  getMaterialMarketQuoteApproveApiPath,
  getMaterialMarketQuoteRejectApiPath,
  getMaterialMarketQuoteSetOfficialApiPath,
  getMaterialMarketQuoteSubmitApprovalApiPath,
} from "@/src/lib/materialsNavigation";
import { formatCurrency } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { MaterialIntelligenceMarketQuoteForm } from "@/src/components/materials/MaterialIntelligenceMarketQuoteForm";

type Props = {
  materialId: string;
  defaultUnit: string;
  marketCriticality?: MaterialMarketCriticality | null;
  quotes: MaterialMarketQuoteApiItem[];
  loading?: boolean;
  onQuoteCreated: () => void;
  onQuotesChanged?: () => void;
};

function officialStatusBadgeClass(status: MaterialMarketQuoteOfficialStatus): string {
  switch (status) {
    case "OFFICIAL":
      return "border-emerald-300 bg-emerald-50 text-emerald-900";
    case "PENDING_APPROVAL":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "APPROVED":
      return "border-blue-300 bg-blue-50 text-blue-900";
    case "REJECTED":
      return "border-red-300 bg-red-50 text-red-900";
    case "REPLACED":
      return "border-slate-300 bg-slate-50 text-slate-700";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function formatApproverMeta(quote: MaterialMarketQuoteApiItem): string | null {
  if (quote.officialStatus === "OFFICIAL" || quote.officialStatus === "APPROVED") {
    const name = quote.approvedByName ?? quote.setOfficialByName;
    const date = quote.approvedAt ?? quote.setOfficialAt;
    if (name && date) {
      return `Aprovada por ${name} em ${formatMaterialIntelligenceQuoteDate(date.slice(0, 10))}`;
    }
    if (name) return `Aprovada por ${name}`;
    if (date) {
      return `Oficial em ${formatMaterialIntelligenceQuoteDate(date.slice(0, 10))}`;
    }
  }
  return null;
}

export function MaterialIntelligenceRecentQuotesSection({
  materialId,
  defaultUnit,
  marketCriticality,
  quotes,
  loading = false,
  onQuoteCreated,
  onQuotesChanged,
}: Props) {
  const auth = useAuth();
  const canEdit = auth.hasPermission("materials.edit");
  const canApprove = canApproveMaterialMarketQuote(auth);
  const [actingQuoteId, setActingQuoteId] = useState<string | null>(null);
  const [rejectQuoteId, setRejectQuoteId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    await onQuoteCreated();
    onQuotesChanged?.();
  };

  const runAction = async (quoteId: string, path: string, body?: unknown) => {
    setActingQuoteId(quoteId);
    setActionError(null);
    try {
      await fetchOk(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      setRejectQuoteId(null);
      setRejectReason("");
      await refresh();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
    } finally {
      setActingQuoteId(null);
    }
  };

  return (
    <MaterialIntelligence360Section
      id="recentQuotes"
      title="Últimas Cotações"
      description="Cotações manuais de mercado registradas para esta matéria-prima."
    >
      <MaterialIntelligenceMarketQuoteForm
        materialId={materialId}
        defaultUnit={defaultUnit}
        onCreated={onQuoteCreated}
      />

      {actionError ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Carregando cotações…</p>
      ) : quotes.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-360-recent-quotes-empty"
        >
          <Receipt className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            {MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Use o formulário acima para registrar a primeira cotação manual.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm" data-testid="material-intelligence-market-quotes-table">
            <thead>
              <tr className="border-b border-border bg-accent/40">
                <th className="p-3 font-semibold">Data</th>
                <th className="p-3 font-semibold">Fornecedor</th>
                <th className="p-3 font-semibold text-right">Preço base</th>
                <th className="p-3 font-semibold text-right">Líquido</th>
                <th className="p-3 font-semibold text-right">Líquido BRL</th>
                <th className="p-3 font-semibold">Câmbio</th>
                <th className="p-3 font-semibold">Unid.</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Governança</th>
                <th className="p-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes.map((quote) => {
                const isActing = actingQuoteId === quote.id;
                const approverMeta = formatApproverMeta(quote);
                const showSubmit = canShowSubmitForApprovalAction({
                  officialStatus: quote.officialStatus,
                  marketCriticality,
                  canEdit,
                });
                const showApproveReject = canShowApproveRejectActions({
                  officialStatus: quote.officialStatus,
                  canApprove,
                });
                const showSetOfficial = canShowSetOfficialAction({
                  officialStatus: quote.officialStatus,
                  marketCriticality,
                  canEdit,
                  canApprove,
                });

                return (
                  <tr key={quote.id} data-testid={`material-market-quote-row-${quote.id}`}>
                    <td className="p-3 text-muted-foreground">
                      {formatMaterialIntelligenceQuoteDate(quote.quoteDate)}
                    </td>
                    <td className="p-3">
                      <span className="font-medium">{quote.supplierName ?? "—"}</span>
                      {quote.origin ? (
                        <p className="text-xs text-muted-foreground">{quote.origin}</p>
                      ) : null}
                    </td>
                    <td className="p-3 text-right">
                      {formatCurrency(quote.price)} {quote.currency}
                    </td>
                    <td className="p-3 text-right font-semibold text-primary">
                      {formatCurrency(quote.netPrice)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {formatCurrency(quote.netPriceBrl ?? quote.netPrice)}
                      {quote.currency.trim().toUpperCase() === "USD" && quote.netPriceBrl != null ? (
                        <p className="text-[11px] text-muted-foreground">
                          orig. {formatCurrency(quote.netPrice)} USD
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {quote.isManualExchange ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900"
                          title={quote.manualExchangeJustification ?? undefined}
                          data-testid={`material-market-quote-manual-badge-${quote.id}`}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          Câmbio informado manualmente
                        </span>
                      ) : quote.exchangeOrigin === "BCB_PTAX" ? (
                        <span className="text-xs text-muted-foreground">
                          PTAX {quote.ptaxVenda != null ? formatCurrency(quote.ptaxVenda) : "—"}
                        </span>
                      ) : quote.ptaxFetchStatus === "FAILED" ? (
                        <span className="text-xs text-amber-800">Sem conversão BRL</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">{quote.unit}</td>
                    <td className="p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {quote.statusLabel}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${officialStatusBadgeClass(quote.officialStatus)}`}
                        data-testid={`material-market-quote-official-status-${quote.id}`}
                      >
                        {quote.officialStatusLabel}
                      </span>
                      {quote.officialStatus === "REJECTED" && quote.rejectionReason ? (
                        <p
                          className="mt-1 text-[11px] text-red-800"
                          data-testid={`material-market-quote-rejection-reason-${quote.id}`}
                        >
                          {quote.rejectionReason}
                        </p>
                      ) : null}
                      {approverMeta ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">{approverMeta}</p>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1.5">
                        {showSubmit ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold hover:bg-accent disabled:opacity-60"
                            disabled={isActing}
                            data-testid={`material-market-quote-submit-approval-${quote.id}`}
                            onClick={() =>
                              void runAction(
                                quote.id,
                                getMaterialMarketQuoteSubmitApprovalApiPath(materialId, quote.id)
                              )
                            }
                          >
                            {isActing ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Send className="h-3 w-3" aria-hidden="true" />
                            )}
                            Enviar para aprovação
                          </button>
                        ) : null}

                        {showApproveReject ? (
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                              disabled={isActing}
                              data-testid={`material-market-quote-approve-${quote.id}`}
                              onClick={() =>
                                void runAction(
                                  quote.id,
                                  getMaterialMarketQuoteApproveApiPath(materialId, quote.id)
                                )
                              }
                            >
                              {isActing ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              ) : (
                                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                              )}
                              Aprovar
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-900 hover:bg-red-100 disabled:opacity-60"
                              disabled={isActing}
                              data-testid={`material-market-quote-reject-open-${quote.id}`}
                              onClick={() => {
                                setRejectQuoteId(quote.id);
                                setRejectReason("");
                                setActionError(null);
                              }}
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                              Rejeitar
                            </button>
                          </div>
                        ) : null}

                        {showSetOfficial ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
                            disabled={isActing}
                            data-testid={`material-market-quote-set-official-${quote.id}`}
                            onClick={() =>
                              void runAction(
                                quote.id,
                                getMaterialMarketQuoteSetOfficialApiPath(materialId, quote.id)
                              )
                            }
                          >
                            {isActing ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="h-3 w-3" aria-hidden="true" />
                            )}
                            Definir como cotação oficial
                          </button>
                        ) : null}
                      </div>

                      {rejectQuoteId === quote.id ? (
                        <div
                          className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2"
                          data-testid={`material-market-quote-reject-modal-${quote.id}`}
                        >
                          <label className="block text-[11px] font-semibold text-foreground">
                            Motivo da rejeição
                            <textarea
                              className="mt-1 w-full min-h-[72px] rounded border border-border bg-background p-2 text-xs"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder="Descreva o motivo da rejeição…"
                            />
                          </label>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md bg-red-700 px-2 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                              disabled={isActing || !rejectReason.trim()}
                              data-testid={`material-market-quote-reject-confirm-${quote.id}`}
                              onClick={() =>
                                void runAction(
                                  quote.id,
                                  getMaterialMarketQuoteRejectApiPath(materialId, quote.id),
                                  { reason: rejectReason }
                                )
                              }
                            >
                              Confirmar rejeição
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-border px-2 py-1 text-xs"
                              onClick={() => setRejectQuoteId(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {quotes.length} cotação(ões) — ordenadas da mais recente para a mais antiga.
          </p>
        </div>
      )}
    </MaterialIntelligence360Section>
  );
}
