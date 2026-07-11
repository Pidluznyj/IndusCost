import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildPortfolioIntelligenceListQuery,
  type PortfolioIntelligenceDataFreshnessDto,
  type PortfolioIntelligenceOrderDetail,
  type PortfolioIntelligenceOrderDetailPayload,
} from "@/src/lib/financePortfolioReconciliationClient";
import { cn } from "@/src/lib/utils";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import {
  confidenceDisplay,
  intelligenceAccordionTitle,
} from "@/src/lib/finance/portfolioIntelligenceUiCopy";
import {
  FINANCIAL_STATUS_LABEL,
  OPERATIONAL_STATUS_LABEL,
  TECHNICAL_ALERT_LABEL,
} from "@/src/lib/finance/portfolioOrderFulfillmentMap";
import { PortfolioFulfillmentStatusCards } from "./PortfolioFulfillmentStatusCards";
import { PortfolioOrderFulfillmentMap } from "./PortfolioOrderFulfillmentMap";

const UNAVAILABLE = "Informação não disponível na importação atual.";

const TABS = [
  { id: "mapa", label: "Mapa de Atendimento" },
  { id: "resumo", label: "Resumo" },
  { id: "pedido", label: "Pedido" },
  { id: "itens", label: "Itens" },
  { id: "nf", label: "NF / saída" },
  { id: "cr", label: "Contas a Receber" },
  { id: "pagamento", label: "Pagamento" },
  { id: "timeline", label: "Histórico" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAG_LABEL: Record<string, string> = {
  DIVERGENCIA_TECNICA: "Divergência a revisar",
  NF_SEM_DOCUMENTO: "NF sem documento de saída",
  DOCUMENTO_SEM_CR: "Documento sem Contas a Receber",
  NF_CABECALHO_MAIOR_PEDIDO: "Valor da NF maior que o pedido",
  DIVERGENCIA_PRECO: "Diferença de preço",
  SEM_CONDICAO_PAGAMENTO: "Sem condição de pagamento",
  VINCULO_INCOMPLETO: "Vínculo incompleto",
  PEDIDO_ANTIGO_SEM_EVOLUCAO: "Pedido antigo sem evolução",
};

function statusLabel(status: string): string {
  return intelligenceAccordionTitle(status) || status;
}

function tagLabel(tag: string): string {
  return TAG_LABEL[tag] ?? tag;
}

function formatFreshnessWhen(iso: string | null | undefined): string {
  if (!iso) return "Informação não disponível";
  if (iso.length > 10) return formatFinanceDateTime(iso);
  return formatFinanceDate(iso);
}

function DataFreshnessBlock({
  freshness,
}: {
  freshness: PortfolioIntelligenceDataFreshnessDto | null | undefined;
}) {
  if (!freshness) return null;
  return (
    <div
      className="rounded-xl border border-sky-200/70 bg-sky-50/40 px-3 py-2.5 space-y-2"
      data-testid="portfolio-intelligence-drawer-freshness"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-950">
        Frescor dos dados
      </p>
      <dl className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Última atualização da run</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {formatFreshnessWhen(freshness.runUpdatedAt ?? freshness.runFinishedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Última evidência de CR</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {formatFreshnessWhen(freshness.lastReceivableEvidenceAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Última baixa encontrada</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {freshness.hasSettlementEvidence
              ? formatFreshnessWhen(freshness.lastSettlementAt)
              : "Nenhuma baixa nesta run"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Atualização do pedido/fato</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {formatFreshnessWhen(freshness.lastOrderOrFactUpdatedAt)}
          </dd>
        </div>
      </dl>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Fonte: {freshness.sourceLabel}
      </p>
      {!freshness.isLatestRun ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-2 py-1.5 text-[10px] text-amber-950">
          Esta run não é a mais recente ({freshness.latestRunId?.slice(0, 8)}…).
          Reabra a conciliação atual ou reconstrua após sincronizar o CR.
        </p>
      ) : null}
      <p
        className="text-[10px] leading-relaxed text-sky-950"
        data-testid="portfolio-intelligence-drawer-freshness-layman"
      >
        {freshness.laymanNotice}
      </p>
      <p
        className="text-[10px] leading-relaxed text-muted-foreground"
        data-testid="portfolio-intelligence-drawer-freshness-sync"
      >
        {freshness.syncRebuildNotice}
      </p>
    </div>
  );
}

function financialRiskText(status: string, confidenceLabelRaw: string): string {
  const conf = confidenceDisplay(confidenceLabelRaw);
  switch (status) {
    case "RECEBIDO":
      return "Baixo risco — já há recebimento evidenciado.";
    case "CR_ABERTO":
      return "Já virou financeiro — acompanhar vencimentos e baixas.";
    case "FATURADO_SEM_CR":
      return "Atenção — saiu nota/documento, mas ainda não virou Contas a Receber.";
    case "CARTEIRA_FUTURA_PROVAVEL":
      return "Ainda só pedido (futuro) — não tratar como caixa confirmado.";
    case "CARTEIRA_PRESENTE_ATENCAO":
      return "Ainda só pedido (atenção) — previsão próxima; acompanhar evolução.";
    case "CARTEIRA_VENCIDA_BLOQUEADA":
      return "Precisa validação — pedido antigo sem evolução. Não tratar como caixa confiável.";
    case "SEM_EVIDENCIA":
      return "Falta evidência na importação atual.";
    default:
      return `${statusLabel(status)} · ${conf.label}.`;
  }
}

function evidencePresent(flags: PortfolioIntelligenceOrderDetail["classification"]["evidenceFlags"]): string[] {
  const out: string[] = [];
  if (flags.hasNfe) out.push("Nota fiscal vinculada");
  if (flags.hasStockDocument) out.push("Documento de saída");
  if (flags.hasAllocatedStockDocument) out.push("Itens do pedido vinculados à saída");
  if (flags.hasReceivable) out.push("Contas a Receber");
  if (flags.hasReceived) out.push("Recebimento / baixa");
  if (flags.hasOpenReceivable) out.push("CR com saldo em aberto");
  return out;
}

function formatQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}

function evidenceAbsent(flags: PortfolioIntelligenceOrderDetail["classification"]["evidenceFlags"]): string[] {
  const out: string[] = [];
  if (!flags.hasNfe) out.push("NF");
  if (!flags.hasStockDocument) out.push("Documento de saída");
  if (!flags.hasReceivable) out.push("Contas a Receber");
  if (!flags.hasReceived) out.push("Baixa / recebimento");
  return out;
}

type Props = {
  open: boolean;
  salesOrderId: string | null;
  runId?: string;
  customerExternalId?: string;
  onClose: () => void;
};

/**
 * Drawer lateral da Inteligência da Carteira — somente leitura; formata a API.
 */
export function PortfolioIntelligenceOrderDrawer({
  open,
  salesOrderId,
  runId = "",
  customerExternalId = "",
  onClose,
}: Props) {
  const portalContainer = usePortalContainer();
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PortfolioIntelligenceOrderDetailPayload | null>(null);
  const [tab, setTab] = useState<TabId>("mapa");

  useEffect(() => {
    if (!open || !salesOrderId) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    setTab("mapa");

    const qs = buildPortfolioIntelligenceListQuery({
      runId,
      customerExternalId,
      page: 1,
      pageSize: 1,
    });

    void (async () => {
      try {
        const data = await fetchJsonOk<PortfolioIntelligenceOrderDetailPayload>(
          `/api/finance/portfolio-reconciliation/intelligence/orders/${encodeURIComponent(salesOrderId)}?${qs}`,
          { signal: ac.signal, credentials: "include" }
        );
        if (!data.ok || !data.detail) {
          setPayload(data);
          setError(data.message ?? "Pedido não encontrado na inteligência materializada.");
          return;
        }
        setPayload(data);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof HttpError && e.status === 404) {
          setError(e.message || "Pedido não encontrado na inteligência materializada.");
          setPayload(null);
          return;
        }
        if (e instanceof HttpError && e.status >= 500) {
          setError(
            "Não foi possível carregar o detalhe do pedido. Tente novamente em instantes."
          );
        } else {
          setError(
            buildFinanceTabLoadError("Não foi possível carregar o detalhe do pedido.", e)
          );
        }
        setPayload(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [open, salesOrderId, runId, customerExternalId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !salesOrderId || !portalContainer) return null;

  const detail = payload?.detail ?? null;
  const classification = detail?.classification;
  const conf = confidenceDisplay(classification?.confidenceLabel);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/30"
      data-testid="portfolio-intelligence-order-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe do pedido — Inteligência da Carteira"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Fechar detalhe"
        onClick={onClose}
      />
      <aside className="relative z-[81] flex h-full w-[75vw] min-w-[720px] max-w-[1200px] flex-col overflow-hidden border-l border-border bg-card shadow-2xl max-sm:min-w-0 max-sm:w-full">
        <header className="shrink-0 border-b border-border/80 bg-gradient-to-b from-slate-50/80 to-card px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Detalhe do pedido · somente leitura
              </p>
              <h2 className="truncate text-base font-semibold text-foreground">
                {detail?.order.orderCode ?? "Pedido"}
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                {detail?.customer.customerName ?? "—"}
                {detail?.seller.sellerName
                  ? ` · ${detail.seller.sellerName}`
                  : detail?.seller.note
                    ? ` · ${detail.seller.note}`
                    : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border p-1.5 hover:bg-muted/60"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {detail && classification ? (
            <div className="mt-3 space-y-3" data-testid="portfolio-intelligence-drawer-header">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] sm:grid-cols-4">
                <div>
                  <dt className="font-semibold text-[#667085]">Pedido</dt>
                  <dd className="font-semibold text-[#344054]">
                    {detail.order.orderCode ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#667085]">Cliente</dt>
                  <dd className="truncate font-semibold text-[#344054]">
                    {detail.customer.customerName ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#667085]">Vendedor</dt>
                  <dd className="truncate font-semibold text-[#344054]">
                    {detail.seller.sellerName ?? detail.seller.note ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#667085]">Valor do pedido</dt>
                  <dd className="text-[20px] font-bold tabular-nums text-[#101828]">
                    {formatFinanceCurrency(detail.values.orderValue)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#667085]">Status financeiro</dt>
                  <dd className="font-semibold text-[#344054]">
                    {detail.fulfillmentMap?.financialStatusLabel ??
                      FINANCIAL_STATUS_LABEL[
                        (detail.fulfillmentMap?.financialStatus ??
                          classification.financialStatus ??
                          "") as keyof typeof FINANCIAL_STATUS_LABEL
                      ] ??
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#667085]">Status operacional</dt>
                  <dd className="font-semibold text-[#344054]">
                    {detail.fulfillmentMap?.operationalStatusLabel ??
                      OPERATIONAL_STATUS_LABEL[
                        (detail.fulfillmentMap?.operationalStatus ??
                          classification.operationalStatus ??
                          "") as keyof typeof OPERATIONAL_STATUS_LABEL
                      ] ??
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#667085]">Confiança</dt>
                  <dd>
                    <span
                      className={cn(
                        "inline-flex flex-col rounded-lg border px-2.5 py-1",
                        conf.className
                      )}
                      title={conf.hint}
                    >
                      <span className="text-[11px] font-semibold leading-tight">
                        {conf.label}
                      </span>
                      <span className="text-[10px] tabular-nums opacity-80">
                        {classification.confidenceScore}
                      </span>
                    </span>
                  </dd>
                </div>
                <div className="sm:col-span-1 col-span-2">
                  <dt className="font-semibold text-[#667085]">Alertas técnicos</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {(
                      detail.fulfillmentMap?.technicalAlerts ??
                      classification.technicalAlerts ??
                      classification.tagsAlerta ??
                      []
                    ).length === 0 ? (
                      <span className="text-[12px] text-[#667085]">Nenhum</span>
                    ) : (
                      (
                        detail.fulfillmentMap?.technicalAlerts ??
                        classification.technicalAlerts ??
                        classification.tagsAlerta ??
                        []
                      ).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-[#FDBA74] bg-[#FFF6ED] px-1.5 py-0.5 text-[11px] font-semibold text-[#C2410C]"
                        >
                          {TECHNICAL_ALERT_LABEL[tag] ?? tagLabel(tag)}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
              </dl>

              {detail.warnings && detail.warnings.length > 0 ? (
                <div
                  className="space-y-1.5"
                  data-testid="portfolio-intelligence-drawer-warnings"
                >
                  {detail.warnings.map((w) => (
                    <p
                      key={w}
                      className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-xs text-amber-950"
                    >
                      {w}
                    </p>
                  ))}
                </div>
              ) : null}

              <DataFreshnessBlock
                freshness={
                  detail.dataFreshness ?? payload?.dataFreshness ?? null
                }
              />

              <PortfolioFulfillmentStatusCards detail={detail} />
            </div>
          ) : null}
        </header>

        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
          aria-label="Abas do detalhe"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                tab === t.id
                  ? "bg-sky-100 text-sky-950"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              data-testid={`portfolio-intelligence-drawer-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div
              className="flex items-center gap-2 py-10 text-sm text-muted-foreground"
              data-testid="portfolio-intelligence-drawer-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando detalhe do pedido…
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-sm text-rose-950"
              data-testid="portfolio-intelligence-drawer-error"
            >
              {error}
            </div>
          ) : null}

          {!loading && detail && classification ? (
            <TabContent tab={tab} detail={detail} />
          ) : null}
        </div>
      </aside>
    </div>,
    portalContainer
  );
}

function TabContent({
  tab,
  detail,
}: {
  tab: TabId;
  detail: PortfolioIntelligenceOrderDetail;
}) {
  const c = detail.classification;
  const flags = c.evidenceFlags;

  if (tab === "mapa") {
    return <PortfolioOrderFulfillmentMap detail={detail} />;
  }

  if (tab === "resumo") {
    const present = evidencePresent(flags);
    const absent = evidenceAbsent(flags);
    return (
      <div className="space-y-3" data-testid="portfolio-intelligence-drawer-resumo">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <InfoCard label="Status" value={statusLabel(c.statusPrincipal)} />
          <InfoCard
            label="Confiança"
            value={`${confidenceDisplay(c.confidenceLabel).label} (${c.confidenceScore})`}
          />
        </div>
        <SectionCard title="Por que esta classificação?">
          <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
            <li>{c.mainReason}</li>
            {c.confidenceReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Próximo passo">
          <p className="text-sm text-foreground">{c.recommendedAction}</p>
        </SectionCard>
        <SectionCard title="Leitura de risco">
          <p className="text-sm text-foreground">
            {financialRiskText(c.statusPrincipal, c.confidenceLabel)}
          </p>
        </SectionCard>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SectionCard title="Evidências encontradas">
            {present.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma evidência comercial encontrada.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {present.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Evidências ausentes">
            {absent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem lacunas evidentes neste pedido.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {absent.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    );
  }

  if (tab === "pedido") {
    const o = detail.order;
    return (
      <div className="space-y-3" data-testid="portfolio-intelligence-drawer-pedido">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Número pedido" value={o.orderCode} />
          <Field
            label="ID Nomus"
            value={o.externalSalesOrderId != null ? String(o.externalSalesOrderId) : UNAVAILABLE}
          />
          <Field label="Data emissão" value={formatFinanceDate(o.issueDate)} />
          <Field
            label="Data prevista"
            value={formatFinanceDate(o.forecastDate ?? o.expectedDeliveryDate)}
          />
          <Field label="Cliente" value={detail.customer.customerName ?? UNAVAILABLE} />
          <Field
            label="Vendedor"
            value={detail.seller.sellerName ?? detail.seller.note ?? UNAVAILABLE}
          />
          <Field label="Empresa" value={UNAVAILABLE} />
          <Field label="Valor do pedido" value={formatFinanceCurrency(o.orderValue)} />
          <Field label="Valor bruto" value={UNAVAILABLE} />
          <Field label="Valor líquido" value={UNAVAILABLE} />
          <Field label="Desconto" value={UNAVAILABLE} />
          <Field label="Frete" value={UNAVAILABLE} />
          <Field label="Impostos" value={UNAVAILABLE} />
          <Field label="Status local / Nomus" value={UNAVAILABLE} />
          <Field
            label="Fonte da previsão"
            value={o.forecastSource || UNAVAILABLE}
          />
        </dl>
        <SectionCard title="Observações">
          <p className="text-sm text-muted-foreground">{UNAVAILABLE}</p>
        </SectionCard>
        <SectionCard title="Notas internas">
          <p className="text-sm text-muted-foreground">{UNAVAILABLE}</p>
        </SectionCard>
      </div>
    );
  }

  if (tab === "itens") {
    const items = detail.items ?? [];
    return (
      <div data-testid="portfolio-intelligence-drawer-itens">
        {items.length === 0 ? (
          <EmptyState message="Não há itens deste pedido na conciliação atual." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="min-w-[900px] w-full border-collapse text-left text-xs">
              <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-semibold">Produto</th>
                  <th className="px-2 py-2 font-semibold">Cód. Nomus</th>
                  <th className="px-2 py-2 font-semibold">Descrição</th>
                  <th className="px-2 py-2 text-right font-semibold">Qtd pedida</th>
                  <th className="px-2 py-2 text-right font-semibold">Qtd alocada</th>
                  <th className="px-2 py-2 text-right font-semibold">Restante</th>
                  <th className="px-2 py-2 text-right font-semibold">Unitário</th>
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.salesOrderItemId ?? `${item.externalProductId}-${item.productSku}`}
                    className="border-t border-border/50"
                  >
                    <td className="px-2 py-1.5 font-medium">
                      {item.productSku ?? (item.externalProductId != null ? String(item.externalProductId) : "—")}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {item.externalProductId != null ? item.externalProductId : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="max-w-[180px] truncate">
                        {item.productDescription ?? "—"}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatQty(item.orderQuantity)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatQty(item.allocatedQuantity)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatQty(item.remainingQuantity)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatFinanceCurrency(item.orderUnitPrice)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatFinanceCurrency(item.orderItemValue)}
                    </td>
                    <td className="px-2 py-1.5">{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (tab === "nf") {
    const nfes = detail.nfeDocuments ?? [];
    const stocks = detail.stockDocuments ?? [];
    const empty = nfes.length === 0 && stocks.length === 0;
    return (
      <div className="space-y-3" data-testid="portfolio-intelligence-drawer-nf">
        {empty ? (
          <EmptyState message="Nenhum documento de saída encontrado para este pedido." />
        ) : (
          <>
            <SectionCard title={`Notas fiscais (${nfes.length})`}>
              {nfes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma NF vinculada.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border/70">
                  <table className="min-w-[800px] w-full border-collapse text-left text-xs">
                    <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 font-semibold">Número NF</th>
                        <th className="px-2 py-2 font-semibold">ID Nomus</th>
                        <th className="px-2 py-2 font-semibold">Série</th>
                        <th className="px-2 py-2 font-semibold">Chave</th>
                        <th className="px-2 py-2 font-semibold">Processamento</th>
                        <th className="px-2 py-2 text-right font-semibold">Valor cabeçalho</th>
                        <th className="px-2 py-2 text-right font-semibold">Valor alocado</th>
                        <th className="px-2 py-2 font-semibold">Divergências</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nfes.map((doc) => (
                        <tr
                          key={`nfe-${doc.nfeExternalId ?? doc.nfeNumber}`}
                          className="border-t border-border/50"
                        >
                          <td className="px-2 py-1.5 font-medium">{doc.nfeNumber ?? "—"}</td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {doc.nfeExternalId != null ? doc.nfeExternalId : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">{UNAVAILABLE}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{UNAVAILABLE}</td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {formatFinanceDate(doc.nfeProcessedAt)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {doc.nfeHeaderValue != null
                              ? formatFinanceCurrency(doc.nfeHeaderValue)
                              : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(doc.allocatedValueToOrder)}
                          </td>
                          <td className="px-2 py-1.5">
                            {[
                              doc.headerOnly ? "Só cabeçalho" : null,
                              doc.surplusOrUnallocatedValue > 0
                                ? `Excedente ${formatFinanceCurrency(doc.surplusOrUnallocatedValue)}`
                                : null,
                              ...doc.alerts,
                            ]
                              .filter(Boolean)
                              .join("; ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard title={`Documentos de saída (${stocks.length})`}>
              {stocks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum documento de saída vinculado.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border/70">
                  <table className="min-w-[700px] w-full border-collapse text-left text-xs">
                    <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 font-semibold">Doc. saída (Nomus)</th>
                        <th className="px-2 py-2 font-semibold">Data</th>
                        <th className="px-2 py-2 font-semibold">Produtos</th>
                        <th className="px-2 py-2 text-right font-semibold">Valor faturado/alocado</th>
                        <th className="px-2 py-2 font-semibold">Alertas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stocks.map((doc) => (
                        <tr
                          key={`stock-${doc.stockDocumentExternalId}`}
                          className="border-t border-border/50"
                        >
                          <td className="px-2 py-1.5 font-medium tabular-nums">
                            {doc.stockDocumentExternalId != null
                              ? doc.stockDocumentExternalId
                              : "—"}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {formatFinanceDate(doc.stockDocumentDate)}
                          </td>
                          <td className="px-2 py-1.5">
                            {doc.productsAllocated.length > 0
                              ? doc.productsAllocated.join(", ")
                              : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(doc.allocatedValueToOrder)}
                          </td>
                          <td className="px-2 py-1.5">
                            {doc.alerts.length > 0 ? doc.alerts.join("; ") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Field
                label="Valor cabeçalho NF (agregado)"
                value={formatFinanceCurrency(detail.values.nfeHeaderValue)}
              />
              <Field
                label="Valor documento / estoque"
                value={formatFinanceCurrency(detail.values.stockDocumentValue)}
              />
              <Field
                label="Valor alocado itemizado"
                value={formatFinanceCurrency(detail.values.itemizedAllocatedValue)}
              />
            </dl>
          </>
        )}
      </div>
    );
  }

  if (tab === "cr") {
    const titles = detail.receivables.titles ?? [];
    const hasCr =
      titles.length > 0 ||
      detail.receivables.receivableTotalValue > 0 ||
      detail.receivables.summary != null;
    return (
      <div className="space-y-3" data-testid="portfolio-intelligence-drawer-cr">
        {!hasCr ? (
          <EmptyState message="Nenhum Contas a Receber encontrado para este pedido." />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <InfoCard
                label="Valor total CR"
                value={formatFinanceCurrency(detail.receivables.receivableTotalValue)}
              />
              <InfoCard
                label="Valor recebido"
                value={formatFinanceCurrency(detail.receivables.receivedValue)}
              />
              <InfoCard
                label="Valor aberto"
                value={formatFinanceCurrency(detail.receivables.openReceivableValue)}
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="min-w-[700px] w-full border-collapse text-left text-xs">
                <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-semibold">Título</th>
                    <th className="px-2 py-2 font-semibold">Vencimento</th>
                    <th className="px-2 py-2 font-semibold">Baixa</th>
                    <th className="px-2 py-2 text-right font-semibold">Valor</th>
                    <th className="px-2 py-2 text-right font-semibold">Recebido</th>
                    <th className="px-2 py-2 text-right font-semibold">Aberto</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {titles.map((t, idx) => (
                    <tr
                      key={`${t.receivableId ?? t.label}-${idx}`}
                      className="border-t border-border/50"
                    >
                      <td className="px-2 py-1.5 font-medium">{t.label}</td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {formatFinanceDate(t.dueDate)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {formatFinanceDate(t.settlementDate)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {t.amount != null ? formatFinanceCurrency(t.amount) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {t.received != null ? formatFinanceCurrency(t.received) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {t.open != null ? formatFinanceCurrency(t.open) : "—"}
                      </td>
                      <td className="px-2 py-1.5">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {titles.some((t) => t.amount == null) ? (
              <p className="text-[11px] text-muted-foreground">
                Valores por título individual podem não estar rateados na importação; use os
                totais do pedido acima.
              </p>
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (tab === "pagamento") {
    const pc = detail.paymentCondition;
    return (
      <div className="space-y-3" data-testid="portfolio-intelligence-drawer-pagamento">
        {!pc.available ? (
          <EmptyState
            message={
              pc.note ?? "Condição de pagamento não disponível na importação atual."
            }
          />
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Condição cadastrada" value={pc.paymentTerms ?? UNAVAILABLE} />
              <Field label="Forma / método" value={pc.paymentMethod ?? UNAVAILABLE} />
              <Field label="Parcelas" value={UNAVAILABLE} />
              <Field label="Prazo" value={UNAVAILABLE} />
              <Field label="Vencimentos projetados" value={UNAVAILABLE} />
              <Field
                label="Fonte da informação"
                value="SalesOrder / enriquecimento da conciliação materializada"
              />
            </dl>
          </>
        )}
      </div>
    );
  }

  // timeline
  const events = detail.timeline ?? [];
  return (
    <div data-testid="portfolio-intelligence-drawer-timeline">
      {events.length === 0 ? (
        <EmptyState message="Ainda não há histórico registrado para este pedido." />
      ) : (
        <ol className="space-y-2">
          {events.map((ev, idx) => (
            <li
              key={`${ev.kind}-${ev.at}-${idx}`}
              className="flex gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
            >
              <div className="w-24 shrink-0 text-xs font-medium tabular-nums text-foreground">
                {formatFinanceDate(ev.at)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{ev.label}</p>
                <p className="text-[11px] text-muted-foreground">{ev.kind}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-background p-3 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-border/80 bg-muted/15 px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
      {message}
    </p>
  );
}
