import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Plus,
  Receipt,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
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
  onRegisterQuote?: () => void;
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

function formatQuotePrice(value: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  return code === "USD" ? `US$ ${formatNumber(value)}` : `${formatCurrency(value)} ${code}`;
}

function QuoteExchangeBadge({ quote }: { quote: MaterialMarketQuoteApiItem }) {
  if (quote.isManualExchange) {
    return (
      <span
        className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900"
        title={quote.manualExchangeJustification ?? "Câmbio informado manualmente"}
        data-testid={`material-market-quote-manual-badge-${quote.id}`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
        Manual
      </span>
    );
  }
  if (quote.exchangeOrigin === "BCB_PTAX") {
    return (
      <span className="inline-block text-xs tabular-nums text-muted-foreground whitespace-nowrap">
        PTAX {quote.ptaxVenda != null ? formatCurrency(quote.ptaxVenda) : "—"}
      </span>
    );
  }
  if (quote.ptaxFetchStatus === "FAILED") {
    return <span className="text-[11px] text-amber-800 whitespace-nowrap">Sem BRL</span>;
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground break-words">{value}</p>
    </div>
  );
}

function QuoteGovernanceActions({
  quote,
  materialId,
  marketCriticality,
  canEdit,
  canApprove,
  isActing,
  purchaseLinkQuoteId,
  rejectQuoteId,
  rejectReason,
  onRunAction,
  onOpenReject,
  onCloseReject,
  onRejectReasonChange,
  onTogglePurchaseLink,
  onRefresh,
}: {
  quote: MaterialMarketQuoteApiItem;
  materialId: string;
  marketCriticality?: MaterialMarketCriticality | null;
  canEdit: boolean;
  canApprove: boolean;
  isActing: boolean;
  purchaseLinkQuoteId: string | null;
  rejectQuoteId: string | null;
  rejectReason: string;
  onRunAction: (quoteId: string, path: string, body?: unknown) => void;
  onOpenReject: (quoteId: string) => void;
  onCloseReject: () => void;
  onRejectReasonChange: (value: string) => void;
  onTogglePurchaseLink: (quoteId: string) => void;
  onRefresh: () => void;
}) {
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
  const approverMeta = formatApproverMeta(quote);

  return (
    <div className="space-y-3" data-testid={`material-market-quote-governance-${quote.id}`}>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Governança
        </p>
        <span
          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${officialStatusBadgeClass(quote.officialStatus)}`}
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
      </div>

      <div className="flex flex-wrap gap-1.5">
        {showSubmit ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold hover:bg-accent disabled:opacity-60"
            disabled={isActing}
            data-testid={`material-market-quote-submit-approval-${quote.id}`}
            onClick={() =>
              onRunAction(quote.id, getMaterialMarketQuoteSubmitApprovalApiPath(materialId, quote.id))
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
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
              disabled={isActing}
              data-testid={`material-market-quote-approve-${quote.id}`}
              onClick={() =>
                onRunAction(quote.id, getMaterialMarketQuoteApproveApiPath(materialId, quote.id))
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
              onClick={() => onOpenReject(quote.id)}
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Rejeitar
            </button>
          </>
        ) : null}

        {showSetOfficial ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
            disabled={isActing}
            data-testid={`material-market-quote-set-official-${quote.id}`}
            onClick={() =>
              onRunAction(quote.id, getMaterialMarketQuoteSetOfficialApiPath(materialId, quote.id))
            }
          >
            {isActing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-3 w-3" aria-hidden="true" />
            )}
            Definir como oficial
          </button>
        ) : null}

        {canEdit ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold hover:bg-accent disabled:opacity-60"
            disabled={isActing}
            data-testid={`material-market-quote-link-purchase-${quote.id}`}
            onClick={() => onTogglePurchaseLink(quote.id)}
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
          onClose={() => onTogglePurchaseLink(quote.id)}
          onCreated={onRefresh}
        />
      ) : null}

      {rejectQuoteId === quote.id ? (
        <div
          className="space-y-2 rounded-md border border-border bg-muted/20 p-2"
          data-testid={`material-market-quote-reject-modal-${quote.id}`}
        >
          <label className="block text-[11px] font-semibold text-foreground">
            Motivo da rejeição
            <textarea
              className="mt-1 w-full min-h-[72px] rounded border border-border bg-background p-2 text-xs"
              value={rejectReason}
              onChange={(e) => onRejectReasonChange(e.target.value)}
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
                onRunAction(
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
              onClick={onCloseReject}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MaterialIntelligenceRecentQuotesSection({
  materialId,
  defaultUnit,
  marketCriticality,
  quotes,
  loading = false,
  onQuoteCreated,
  onQuotesChanged,
  onRegisterQuote,
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

  const sectionDescription =
    quotes.length > 0
      ? `${quotes.length} cotação(ões) registrada(s) — leitura executiva das cotações manuais de mercado.`
      : "Cotações manuais de mercado registradas para esta matéria-prima.";

  return (
    <MaterialIntelligence360Section
      id="recentQuotes"
      title="Últimas Cotações"
      description={sectionDescription}
      className="w-full min-w-0"
      actions={
        onRegisterQuote ? (
          <button
            type="button"
            onClick={onRegisterQuote}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent"
            data-testid="material-intelligence-register-quote-section"
          >
            <Plus className="h-3.5 w-3.5" />
            Registrar cotação
          </button>
        ) : undefined
      }
    >
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
            Use o botão &quot;Registrar cotação&quot; para lançar a primeira cotação manual.
          </p>
        </div>
      ) : (
        <div
          className="w-full min-w-0 overflow-x-auto rounded-lg border border-border lg:overflow-x-visible"
          data-testid="material-intelligence-recent-quotes-table-wrap"
        >
          <table
            className="w-full min-w-[52rem] table-fixed text-left text-sm lg:min-w-0"
            data-testid="material-intelligence-market-quotes-table"
          >
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[22%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[7%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-accent/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-semibold">Data</th>
                <th className="px-3 py-2.5 font-semibold">Fornecedor</th>
                <th className="px-3 py-2.5 font-semibold text-right">Preço base</th>
                <th className="px-3 py-2.5 font-semibold text-right">Líquido</th>
                <th className="px-3 py-2.5 font-semibold text-right">Líquido BRL</th>
                <th className="px-3 py-2.5 font-semibold">Câmbio</th>
                <th className="px-3 py-2.5 font-semibold">Unid.</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes.map((quote) => {
                const isActing = actingQuoteId === quote.id;
                const isExpanded = expandedQuoteId === quote.id;

                return (
                  <React.Fragment key={quote.id}>
                    <tr
                      className="hover:bg-muted/20"
                      data-testid={`material-market-quote-row-${quote.id}`}
                    >
                      <td className="px-3 py-2.5 align-top">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-left text-muted-foreground hover:text-foreground whitespace-nowrap"
                          onClick={() =>
                            setExpandedQuoteId((current) =>
                              current === quote.id ? null : quote.id
                            )
                          }
                          aria-expanded={isExpanded}
                          data-testid={`material-market-quote-expand-${quote.id}`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="tabular-nums">
                            {formatMaterialIntelligenceQuoteDate(quote.quoteDate)}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5 align-top min-w-0">
                        <p
                          className="font-medium text-foreground truncate"
                          title={quote.supplierName ?? undefined}
                        >
                          {quote.supplierName ?? "—"}
                        </p>
                        {quote.manufacturer ? (
                          <p
                            className="mt-0.5 text-[11px] text-muted-foreground truncate"
                            title={quote.manufacturer}
                          >
                            {quote.manufacturer}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right tabular-nums text-muted-foreground whitespace-nowrap">
                        {formatQuotePrice(quote.price, quote.currency)}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right tabular-nums font-semibold text-primary whitespace-nowrap">
                        {quote.currency.trim().toUpperCase() === "USD"
                          ? `US$ ${formatNumber(quote.netPrice)}`
                          : formatCurrency(quote.netPrice)}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right tabular-nums font-medium text-foreground whitespace-nowrap">
                        {formatCurrency(quote.netPriceBrl ?? quote.netPrice)}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <QuoteExchangeBadge quote={quote} />
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span className="inline-flex rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                          {quote.unit || defaultUnit}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                            {quote.statusLabel}
                          </span>
                          <MaterialIntelligenceQuoteReliabilityBadge
                            level={quote.reliabilityLevel}
                            suggestedLevel={quote.reliabilitySuggestedLevel}
                          />
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${officialStatusBadgeClass(quote.officialStatus)}`}
                          >
                            {quote.officialStatusLabel}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr data-testid={`material-market-quote-detail-${quote.id}`}>
                        <td colSpan={8} className="bg-muted/10 px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-3">
                            <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Detalhes comerciais
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <DetailField label="Origem" value={quote.origin ?? "—"} />
                                <DetailField label="Fabricante" value={quote.manufacturer ?? "—"} />
                                <DetailField
                                  label="Validade da proposta"
                                  value={
                                    quote.proposalValidityDate
                                      ? formatMaterialIntelligenceQuoteDate(quote.proposalValidityDate)
                                      : "—"
                                  }
                                />
                                <DetailField
                                  label="Condições de pagamento"
                                  value={quote.paymentTerms ?? "—"}
                                />
                                <DetailField label="Observações" value={quote.notes ?? "—"} />
                              </div>
                            </div>

                            <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Composição de preço
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <DetailField
                                  label="Frete"
                                  value={
                                    quote.freightValue != null
                                      ? formatCurrency(quote.freightValue)
                                      : "—"
                                  }
                                />
                                <DetailField
                                  label="Impostos"
                                  value={
                                    quote.taxValue != null ? formatCurrency(quote.taxValue) : "—"
                                  }
                                />
                                <DetailField
                                  label="Câmbio"
                                  value={
                                    quote.isManualExchange
                                      ? `Manual${quote.manualExchangeJustification ? ` — ${quote.manualExchangeJustification}` : ""}`
                                      : quote.exchangeOriginLabel ?? "—"
                                  }
                                />
                                <DetailField
                                  label="PTAX / taxa"
                                  value={
                                    quote.ptaxVenda != null
                                      ? formatCurrency(quote.ptaxVenda)
                                      : "—"
                                  }
                                />
                                <DetailField
                                  label="Preço base BRL"
                                  value={
                                    quote.priceBrl != null
                                      ? formatCurrency(quote.priceBrl)
                                      : "—"
                                  }
                                />
                                <DetailField
                                  label="Moeda original"
                                  value={`${quote.currency} · ${formatQuotePrice(quote.price, quote.currency)}`}
                                />
                              </div>
                            </div>

                            <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
                              <QuoteGovernanceActions
                                quote={quote}
                                materialId={materialId}
                                marketCriticality={marketCriticality}
                                canEdit={canEdit}
                                canApprove={canApprove}
                                isActing={isActing}
                                purchaseLinkQuoteId={purchaseLinkQuoteId}
                                rejectQuoteId={rejectQuoteId}
                                rejectReason={rejectReason}
                                onRunAction={(quoteId, path, body) => void runAction(quoteId, path, body)}
                                onOpenReject={(quoteId) => {
                                  setRejectQuoteId(quoteId);
                                  setRejectReason("");
                                  setActionError(null);
                                }}
                                onCloseReject={() => setRejectQuoteId(null)}
                                onRejectReasonChange={setRejectReason}
                                onTogglePurchaseLink={(quoteId) => {
                                  setPurchaseLinkQuoteId(
                                    purchaseLinkQuoteId === quoteId ? null : quoteId
                                  );
                                  setActionError(null);
                                }}
                                onRefresh={() => void refresh()}
                              />
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border/60 bg-card p-3">
                            <div className="space-y-2 text-sm min-w-0 flex-1">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Confiabilidade da informação
                              </p>
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
                              <p className="text-xs text-muted-foreground">
                                {quote.attachmentCount > 0
                                  ? `${quote.attachmentCount} anexo(s) de evidência`
                                  : "Sem anexos de evidência"}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
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
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <p
            className="border-t border-border px-3 py-2 text-xs text-muted-foreground"
            data-testid="material-intelligence-recent-quotes-count"
          >
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
