import React, { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Receipt, Send, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchOk } from "@/src/lib/http";
import type { MaterialMarketQuoteApiItem } from "@/src/lib/materialMarketQuote";
import {
  canApproveMaterialMarketQuote,
  canShowApproveRejectActions,
  canShowSetOfficialAction,
  canShowSubmitForApprovalAction,
  type MaterialMarketQuoteOfficialStatus,
} from "@/src/lib/materialMarketQuoteGovernance";
import {
  formatMaterialIntelligenceQuoteDate,
  MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE,
} from "@/src/lib/materialIntelligence360Sections";
import type { MaterialMarketCriticality } from "@/src/lib/materialMarketMonitoring";
import { canAdjustMaterialMarketQuoteReliability } from "@/src/lib/materialMarketQuoteReliability";
import {
  getMaterialMarketQuoteApproveApiPath,
  getMaterialMarketQuoteRejectApiPath,
  getMaterialMarketQuoteSetOfficialApiPath,
  getMaterialMarketQuoteSubmitApprovalApiPath,
} from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { MaterialIntelligenceMarketQuoteForm } from "@/src/components/materials/MaterialIntelligenceMarketQuoteForm";
import { MaterialIntelligencePurchaseLinkForm } from "@/src/components/materials/MaterialIntelligencePurchaseLinkForm";
import { MaterialMarketQuoteAttachmentsPanel } from "@/src/components/materials/MaterialMarketQuoteAttachmentsPanel";
import { MaterialIntelligenceQuoteReliabilityBadge } from "@/src/components/materials/MaterialIntelligenceQuoteReliabilityBadge";
import { MaterialIntelligenceQuoteReliabilityModal } from "@/src/components/materials/MaterialIntelligenceQuoteReliabilityModal";

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
  const canAdjustReliability =
    auth.authUser != null &&
    canAdjustMaterialMarketQuoteReliability({
      role: auth.authUser.role,
      permissions: auth.authUser.permissions,
      effectivePermissions: auth.authUser.effectivePermissions,
    });
  const [actingQuoteId, setActingQuoteId] = useState<string | null>(null);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [reliabilityQuote, setReliabilityQuote] = useState<MaterialMarketQuoteApiItem | null>(null);
  const [rejectQuoteId, setRejectQuoteId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [purchaseLinkQuoteId, setPurchaseLinkQuoteId] = useState<string | null>(null);

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
                <th className="p-3 font-semibold">Confiabilidade</th>
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
                  <React.Fragment key={quote.id}>
                  <tr data-testid={`material-market-quote-row-${quote.id}`}>
                    <td className="p-3 text-muted-foreground">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() =>
                          setExpandedQuoteId((current) =>
                            current === quote.id ? null : quote.id
                          )
                        }
                        aria-expanded={expandedQuoteId === quote.id}
                        data-testid={`material-market-quote-expand-${quote.id}`}
                      >
                        {expandedQuoteId === quote.id ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {formatMaterialIntelligenceQuoteDate(quote.quoteDate)}
                      </button>
                    </td>
                    <td className="p-3">
                      <span className="font-medium">{quote.supplierName ?? "—"}</span>
                      {quote.origin ? (
                        <p className="text-xs text-muted-foreground">{quote.origin}</p>
                      ) : null}
                    </td>
                    <td className="p-3 text-right">
                      {quote.currency.trim().toUpperCase() === "USD"
                        ? `US$ ${formatNumber(quote.price)}`
                        : `${formatCurrency(quote.price)} ${quote.currency}`}
                    </td>
                    <td className="p-3 text-right font-semibold text-primary">
                      {quote.currency.trim().toUpperCase() === "USD"
                        ? `US$ ${formatNumber(quote.netPrice)}`
                        : formatCurrency(quote.netPrice)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {formatCurrency(quote.netPriceBrl ?? quote.netPrice)}
                      {quote.currency.trim().toUpperCase() === "USD" && quote.netPriceBrl != null ? (
                        <p className="text-[11px] text-muted-foreground">
                          orig. US$ {formatNumber(quote.netPrice)}
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
                      <MaterialIntelligenceQuoteReliabilityBadge
                        level={quote.reliabilityLevel}
                        suggestedLevel={quote.reliabilitySuggestedLevel}
                      />
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

                        {canEdit ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold hover:bg-accent disabled:opacity-60"
                            disabled={isActing}
                            data-testid={`material-market-quote-link-purchase-${quote.id}`}
                            onClick={() => {
                              setPurchaseLinkQuoteId(
                                purchaseLinkQuoteId === quote.id ? null : quote.id
                              );
                              setActionError(null);
                            }}
                          >
                            <Link2 className="h-3 w-3" aria-hidden="true" />
                            Vincular compra
                          </button>
                        ) : null}

                      </div>

                      {purchaseLinkQuoteId === quote.id ? (
                        <MaterialIntelligencePurchaseLinkForm
                          materialId={materialId}
                          quote={quote}
                          open
                          onClose={() => setPurchaseLinkQuoteId(null)}
                          onCreated={() => void refresh()}
                        />
                      ) : null}

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
                  {expandedQuoteId === quote.id ? (
                    <tr data-testid={`material-market-quote-detail-${quote.id}`}>
                      <td colSpan={10} className="bg-muted/15 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-2 text-sm">
                            <p className="font-semibold">Confiabilidade da informação</p>
                            <div className="flex flex-wrap items-center gap-3">
                              <div>
                                <p className="text-xs text-muted-foreground">Nível aplicado</p>
                                <MaterialIntelligenceQuoteReliabilityBadge
                                  level={quote.reliabilityLevel}
                                  showSuggestionHint={false}
                                />
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {quote.reliabilityLevelLabel}
                                </p>
                              </div>
                              {quote.reliabilitySuggestedLevel ? (
                                <div>
                                  <p className="text-xs text-muted-foreground">Sugestão automática</p>
                                  <MaterialIntelligenceQuoteReliabilityBadge
                                    level={quote.reliabilitySuggestedLevel}
                                    showSuggestionHint={false}
                                  />
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {quote.reliabilitySuggestedLabel}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                            {quote.reliabilityOverrideReason ? (
                              <p className="text-xs text-muted-foreground">
                                Justificativa: {quote.reliabilityOverrideReason}
                              </p>
                            ) : null}
                            {quote.attachmentCount > 0 ? (
                              <p className="text-xs text-muted-foreground">
                                {quote.attachmentCount} anexo(s) de evidência
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">Sem anexos de evidência</p>
                            )}
                          </div>
                          <MaterialMarketQuoteAttachmentsPanel
                            materialId={materialId}
                            quoteId={quote.id}
                            canEdit={canEdit}
                            onAttachmentsChanged={() => void refresh()}
                          />
                          {canAdjustReliability ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                              data-testid={`material-market-quote-adjust-reliability-${quote.id}`}
                              onClick={() => setReliabilityQuote(quote)}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              Ajustar confiabilidade
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {quotes.length} cotação(ões) — ordenadas da mais recente para a mais antiga.
          </p>
        </div>
      )}

      {reliabilityQuote ? (
        <MaterialIntelligenceQuoteReliabilityModal
          materialId={materialId}
          quoteId={reliabilityQuote.id}
          currentLevel={reliabilityQuote.reliabilityLevel}
          suggestedLevel={reliabilityQuote.reliabilitySuggestedLevel}
          overrideReason={reliabilityQuote.reliabilityOverrideReason}
          open
          onClose={() => setReliabilityQuote(null)}
          onSaved={() => void refresh()}
        />
      ) : null}
    </MaterialIntelligence360Section>
  );
}
