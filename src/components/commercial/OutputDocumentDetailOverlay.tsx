import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Overlay,
  OverlayBadge,
  OverlayBody,
  OverlayHeader,
  OverlayKpiCard,
  OverlayKpiCardGrid,
  OverlaySection,
  OverlayTable,
  OverlayTabs,
} from "@/src/components/ui/overlay";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  fetchOutputDocumentDetail,
  type OutputDocumentDetailPayload,
} from "@/src/lib/outputDocumentsClient";
import type { OutputDocumentDetailItem } from "@/src/lib/output-documents/outputDocumentsDetailTypes";
import {
  buildOutputDocumentNfeSearchHref,
  buildOutputDocumentSalesOrderHref,
  canViewOutputDocumentsRaw,
  classifyOutputDocumentsDetailError,
  formatOutputDocumentCancellation,
  formatOutputDocumentDate,
  formatOutputDocumentDateTime,
  formatOutputDocumentFinancialStatusLabel,
  formatOutputDocumentItemDescription,
  formatOutputDocumentItemLinkStatusLabel,
  formatOutputDocumentItemLocalProduct,
  formatOutputDocumentItemOrder,
  formatOutputDocumentItemOrderItem,
  formatOutputDocumentItemSkuLabel,
  formatOutputDocumentItemUnit,
  formatOutputDocumentLabel,
  formatOutputDocumentMoney,
  formatOutputDocumentNfeCancellation,
  formatOutputDocumentNfeDocumentaryDiffs,
  formatOutputDocumentNfeStatusLabel,
  formatOutputDocumentNumber,
  formatOutputDocumentPrimaryNfe,
  formatOutputDocumentStatusLabel,
  OUTPUT_DOCUMENT_AWAITING_CR_MESSAGE,
  outputDocumentFinancialStatusTone,
  outputDocumentInconsistencyTone,
  outputDocumentItemLinkStatusTone,
  outputDocumentStatusTone,
  resolveOutputDocumentDetailHeaderLinks,
  resolveOutputDocumentDetailNavigationCapabilities,
} from "@/src/lib/outputDocumentsUi";
import { cn } from "@/src/lib/utils";

type Props = {
  outputDocumentId: string | null;
  onClose: () => void;
  onOpenSalesOrder?: (salesOrderId: string, orderCode?: string | null) => void;
  onOpenNfe?: (nfe: { numero: string | null; externalId: number }) => void;
  dismissOnEsc?: boolean;
};

export type OutputDocumentDetailTab =
  | "geral"
  | "itens"
  | "pedidos"
  | "nfes"
  | "financeiro"
  | "auditoria";

export function OutputDocumentDetailOverlay({
  outputDocumentId,
  onClose,
  onOpenSalesOrder,
  onOpenNfe,
  dismissOnEsc = true,
}: Props) {
  const auth = useAuth();
  const permissions = usePermissions();
  const [searchParams] = useSearchParams();
  const includeRaw = canViewOutputDocumentsRaw({
    canPerformAction: permissions.canPerformAction,
    hasPermission: auth.hasPermission,
  });
  const navigationCapabilities = useMemo(
    () =>
      resolveOutputDocumentDetailNavigationCapabilities({
        canPerformAction: permissions.canPerformAction,
        canViewModule: permissions.canViewModule,
      }),
    [permissions.canPerformAction, permissions.canViewModule]
  );
  const [detail, setDetail] = useState<OutputDocumentDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<
    "not_found" | "access_denied" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OutputDocumentDetailTab>("geral");

  useEffect(() => {
    setRefreshToken(0);
    setActiveTab("geral");
    setCopyFeedback(null);
  }, [outputDocumentId]);

  useEffect(() => {
    if (!outputDocumentId) {
      setDetail(null);
      setErrorKind(null);
      setErrorMessage(null);
      return;
    }
    const controller = new AbortController();
    if (refreshToken === 0) setDetail(null);
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);
    void fetchOutputDocumentDetail(outputDocumentId, {
      includeRaw,
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) setDetail(payload);
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        const classified = classifyOutputDocumentsDetailError(cause);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [outputDocumentId, includeRaw, refreshToken]);

  const headerLinks = useMemo(
    () =>
      detail
        ? resolveOutputDocumentDetailHeaderLinks(detail, navigationCapabilities, {
            currentSearchParams: searchParams,
          })
        : [],
    [detail, navigationCapabilities, searchParams]
  );

  const documentLabel = detail
    ? formatOutputDocumentNumber({
        documentNumber: detail.document.documentNumber,
        externalId: detail.document.externalId,
      })
    : null;

  const handleCopyDocumentNumber = useCallback(async () => {
    if (!documentLabel || documentLabel === "—") return;
    try {
      await navigator.clipboard.writeText(documentLabel);
      setCopyFeedback("Número copiado");
    } catch {
      setCopyFeedback("Não foi possível copiar");
    }
  }, [documentLabel]);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = window.setTimeout(() => setCopyFeedback(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const tabs = useMemo(
    () => [
      { id: "geral" as const, label: "Geral" },
      { id: "itens" as const, label: "Itens", count: detail?.items.length },
      {
        id: "pedidos" as const,
        label: "Pedidos de Venda",
        count: detail?.orders.length,
      },
      { id: "nfes" as const, label: "NF-e", count: detail?.nfes.length },
      { id: "financeiro" as const, label: "Financeiro" },
      { id: "auditoria" as const, label: "Auditoria" },
    ],
    [detail]
  );

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("geral");
    }
  }, [tabs, activeTab]);

  const titleId = "output-document-detail-title";

  return (
    <Overlay
      open={outputDocumentId != null}
      onClose={onClose}
      size="full"
      dismissOnEsc={dismissOnEsc}
      ariaLabelledBy={titleId}
      ariaDescribedBy="output-document-detail-description"
      testId="output-document-detail-drawer"
      className="h-[calc(100vh-2rem)] !max-w-[1400px] sm:h-[92vh]"
    >
      <OverlayHeader
        titleId={titleId}
        eyebrow={
          detail
            ? `Comercial · Documentos de Saída · Nomus #${detail.document.externalId}`
            : "Comercial · Documento de Saída"
        }
        title={
          detail
            ? `Detalhe do Documento — ${documentLabel}`
            : "Detalhe do Documento de Saída"
        }
        subtitle={
          <span id="output-document-detail-description">
            {detail
              ? `${detail.document.company.name ?? "Empresa não informada"} · Última sincronização: ${formatOutputDocumentDateTime(detail.document.sync.syncedAt)}`
              : "Consulta local somente leitura"}
          </span>
        }
        actions={
          detail ? (
            <div className="hidden items-center gap-2 sm:flex">
              <OverlayBadge
                tone={outputDocumentStatusTone({
                  isCancelled: detail.document.cancellation.isCancelled,
                  statusRaw: detail.document.statusRaw,
                })}
                emphasized
              >
                {formatOutputDocumentStatusLabel({
                  isCancelled: detail.document.cancellation.isCancelled,
                  statusRaw: detail.document.statusRaw,
                })}
              </OverlayBadge>
              {detail.financial ? (
                <OverlayBadge
                  tone={outputDocumentFinancialStatusTone(detail.financial.status)}
                >
                  {formatOutputDocumentFinancialStatusLabel(detail.financial.status)}
                </OverlayBadge>
              ) : null}
            </div>
          ) : null
        }
        onClose={onClose}
        closeLabel="Fechar detalhe"
        density="default"
      />
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2"
        data-testid="output-document-detail-nav"
      >
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent"
          onClick={onClose}
          data-testid="output-document-detail-back-list"
        >
          Voltar para a lista
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50"
          onClick={() => void handleCopyDocumentNumber()}
          disabled={!documentLabel || documentLabel === "—"}
          data-testid="output-document-detail-copy-number"
          title="Copiar número do documento"
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
          Copiar número
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50"
          onClick={() => setRefreshToken((token) => token + 1)}
          disabled={!outputDocumentId || loading}
          data-testid="output-document-detail-refresh"
          title="Atualizar dados do documento"
        >
          <RefreshCw
            className={cn("h-3 w-3", loading && "animate-spin")}
            aria-hidden="true"
          />
          {loading ? "Atualizando…" : "Atualizar"}
        </button>
        {headerLinks.map((link) => {
          if (link.id === "nfe") {
            const primaryNfe =
              detail?.nfes.find((nfe) => nfe.isPrimary) ?? detail?.nfes[0] ?? null;
            if (!primaryNfe) return null;
            if (onOpenNfe) {
              return (
                <button
                  key={link.id}
                  type="button"
                  className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent"
                  data-testid={link.testId}
                  onClick={() => onOpenNfe(primaryNfe)}
                >
                  {link.label}
                </button>
              );
            }
          }
          return (
            <Link
              key={link.id}
              to={link.href}
              className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent"
              data-testid={link.testId}
            >
              {link.label}
            </Link>
          );
        })}
        {copyFeedback ? (
          <span
            className="text-xs text-muted-foreground"
            aria-live="polite"
            data-testid="output-document-detail-copy-feedback"
          >
            {copyFeedback}
          </span>
        ) : null}
      </div>
      <OverlayTabs
        tabs={tabs}
        active={activeTab}
        onChange={setActiveTab}
        variant="pill"
        testId="output-document-detail-tabs"
        ariaLabel="Seções do detalhe do Documento de Saída"
      />
      <OverlayBody className="bg-[color:var(--color-overlay-surface-muted)] px-4 py-4">
        {loading ? (
          <DrawerState testId="output-document-detail-loading">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando detalhe…
          </DrawerState>
        ) : errorMessage ? (
          <div className="space-y-3">
            <div
              role="alert"
              className={
                errorKind === "not_found"
                  ? "rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-950"
                  : "rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
              }
              data-testid={
                errorKind === "not_found"
                  ? "output-document-detail-not-found"
                  : "output-document-detail-error"
              }
            >
              {errorMessage}
            </div>
            {errorKind !== "not_found" && errorKind !== "access_denied" ? (
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
                data-testid="output-document-detail-retry"
                onClick={() => setRefreshToken((token) => token + 1)}
              >
                Tentar novamente
              </button>
            ) : null}
          </div>
        ) : detail ? (
          <OutputDocumentDetailContent
            detail={detail}
            activeTab={activeTab}
            onOpenSalesOrder={onOpenSalesOrder}
          />
        ) : null}
      </OverlayBody>
    </Overlay>
  );
}

export function OutputDocumentDetailContent({
  detail,
  activeTab = "geral",
  onOpenSalesOrder,
}: {
  detail: OutputDocumentDetailPayload;
  activeTab?: OutputDocumentDetailTab;
  onOpenSalesOrder?: (salesOrderId: string, orderCode?: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      {detail.inconsistencies.length > 0 ? (
        <InconsistenciesBanner inconsistencies={detail.inconsistencies} />
      ) : null}
      {activeTab === "itens" ? (
        <ItemsPanel detail={detail} onOpenSalesOrder={onOpenSalesOrder} />
      ) : activeTab === "pedidos" ? (
        <OrdersPanel detail={detail} onOpenSalesOrder={onOpenSalesOrder} />
      ) : activeTab === "nfes" ? (
        <NfesPanel detail={detail} />
      ) : activeTab === "financeiro" ? (
        <FinancialPanel detail={detail} />
      ) : activeTab === "auditoria" ? (
        <AuditPanel detail={detail} />
      ) : (
        <GeneralPanel detail={detail} />
      )}
    </div>
  );
}

function InconsistenciesBanner({
  inconsistencies,
}: {
  inconsistencies: OutputDocumentDetailPayload["inconsistencies"];
}) {
  return (
    <div
      className="rounded-xl border border-amber-300/70 bg-amber-50 p-3"
      data-testid="output-document-detail-inconsistencies"
      role="status"
    >
      <p className="text-xs font-bold uppercase tracking-wider text-amber-950">
        Inconsistências ({inconsistencies.length})
      </p>
      <ul className="mt-2 space-y-1.5">
        {inconsistencies.map((entry) => (
          <li
            key={`${entry.code}-${entry.message}`}
            className="flex flex-wrap items-center gap-2 text-sm text-amber-950"
          >
            <OverlayBadge tone={outputDocumentInconsistencyTone(entry.severity)}>
              {entry.severity}
            </OverlayBadge>
            <span className="font-medium">{entry.code}</span>
            <span className="text-amber-900/90">{entry.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GeneralPanel({ detail }: { detail: OutputDocumentDetailPayload }) {
  const documentLabel = formatOutputDocumentNumber({
    documentNumber: detail.document.documentNumber,
    externalId: detail.document.externalId,
  });

  return (
    <div
      id="overlay-panel-geral"
      role="tabpanel"
      className="space-y-4"
      data-testid="output-document-detail-general-panel"
    >
      <OverlaySection title="Documento">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Documento de Saída Nomus ·{" "}
              {detail.document.company.name ?? "Empresa não informada"}
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-foreground">
              {documentLabel}
            </h2>
          </div>
          <OverlayBadge
            tone={outputDocumentStatusTone({
              isCancelled: detail.document.cancellation.isCancelled,
              statusRaw: detail.document.statusRaw,
            })}
            emphasized
          >
            {formatOutputDocumentStatusLabel({
              isCancelled: detail.document.cancellation.isCancelled,
              statusRaw: detail.document.statusRaw,
            })}
          </OverlayBadge>
        </div>
        <DetailFieldGrid className="mt-4">
          <DetailField label="Documento" value={documentLabel} />
          <DetailField
            label="Status"
            value={formatOutputDocumentStatusLabel({
              isCancelled: detail.document.cancellation.isCancelled,
              statusRaw: detail.document.statusRaw,
            })}
          />
          <DetailField
            label="Empresa"
            value={formatOutputDocumentLabel(detail.document.company.name)}
          />
          <DetailField
            label="Cliente"
            value={formatOutputDocumentLabel(detail.document.customer.name)}
          />
          <DetailField
            label="Emissão"
            value={formatOutputDocumentDate(detail.document.dataDocumento)}
          />
          <DetailField
            label="Cancelamento"
            value={formatOutputDocumentCancellation(detail.document.cancellation)}
          />
          <DetailField
            label="NF-e"
            value={formatOutputDocumentPrimaryNfe(detail.nfes)}
          />
          <DetailField
            label="Situação financeira"
            value={
              detail.financial
                ? formatOutputDocumentFinancialStatusLabel(detail.financial.status)
                : detail.permissions.canViewFinancial
                  ? "Sem informação financeira"
                  : "Sem permissão ou sem dados"
            }
          />
          <DetailField
            label="Condição de pagamento"
            value={formatOutputDocumentLabel(detail.document.paymentTermsRaw)}
          />
          <DetailField
            label="Sincronização"
            value={formatOutputDocumentDateTime(detail.document.sync.syncedAt)}
          />
        </DetailFieldGrid>
      </OverlaySection>

      <OverlaySection title="Valores">
        <OverlayKpiCardGrid columns={4}>
          <OverlayKpiCard
            label="Valor total"
            value={formatOutputDocumentMoney(detail.values.totalValue)}
            tone="info"
            size="sm"
          />
          <OverlayKpiCard
            label="Valor dos itens"
            value={formatOutputDocumentMoney(detail.values.itemsSum)}
            tone="neutral"
            size="sm"
          />
          <OverlayKpiCard
            label="Valor alocado"
            value={formatOutputDocumentMoney(detail.values.allocatedToOrders)}
            tone="positive"
            size="sm"
          />
          <OverlayKpiCard
            label="Saldo não alocado"
            value={formatOutputDocumentMoney(detail.values.unallocatedBalance)}
            tone={detail.values.unallocatedBalance > 0 ? "warning" : "neutral"}
            size="sm"
          />
        </OverlayKpiCardGrid>
      </OverlaySection>
    </div>
  );
}

function ItemsPanel({
  detail,
  onOpenSalesOrder,
}: {
  detail: OutputDocumentDetailPayload;
  onOpenSalesOrder?: (salesOrderId: string, orderCode?: string | null) => void;
}) {
  return (
    <div
      id="overlay-panel-itens"
      role="tabpanel"
      className="space-y-4"
      data-testid="output-document-detail-items-panel"
    >
      <OverlaySection
        title="Itens do documento"
        description={`${detail.resolution.itemCount} item(ns) · ${detail.resolution.itemsResolved} resolvido(s) · ${detail.resolution.itemsUnresolved} não resolvido(s)`}
      >
        <OutputDocumentItemsTable
          items={detail.items}
          onOpenSalesOrder={onOpenSalesOrder}
        />
      </OverlaySection>
    </div>
  );
}

function OrdersPanel({
  detail,
  onOpenSalesOrder,
}: {
  detail: OutputDocumentDetailPayload;
  onOpenSalesOrder?: (salesOrderId: string, orderCode?: string | null) => void;
}) {
  return (
    <div
      id="overlay-panel-pedidos"
      role="tabpanel"
      className="space-y-4"
      data-testid="output-document-detail-orders-panel"
    >
      <OverlaySection
        title="Pedidos de Venda"
        description={`${detail.orders.length} pedido(s) · cobertura ${detail.allocations.coverageStatus}`}
      >
        {detail.orders.length === 0 ? (
          <EmptyBlock testId="output-document-detail-orders-empty">
            {detail.document.idNfe != null
              ? `Nenhum pedido em SalesOrderNfeLink para idNfe ${detail.document.idNfe} nem em alocação O2C deste documento.`
              : "Nenhum pedido vinculado: documento sem idNfe e sem alocação O2C."}
          </EmptyBlock>
        ) : (
          <OverlayTable
            className="min-w-[1040px]"
            data-testid="output-document-detail-orders-table"
          >
            <OverlayTable.Head>
              <OverlayTable.Row>
                {[
                  "Pedido",
                  "Data",
                  "Status",
                  "Vendedor",
                  "Valor",
                  "Valor alocado",
                  "% cobertura",
                  "Abrir",
                ].map((label) => (
                  <OverlayTable.HeadCell key={label}>{label}</OverlayTable.HeadCell>
                ))}
              </OverlayTable.Row>
            </OverlayTable.Head>
            <OverlayTable.Body>
              {detail.orders.map((order) => (
                <OverlayTable.Row
                  key={order.salesOrderId}
                  data-testid={`output-document-detail-order-${order.salesOrderId}`}
                >
                  <OverlayTable.Cell mono>
                    {order.orderCode?.trim() || order.salesOrderId}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentDate(order.issueDate)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentLabel(order.status)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentLabel(order.officialSeller.name)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono className="tabular-nums">
                    {formatOutputDocumentMoney(order.orderValue)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono className="tabular-nums">
                    {formatOutputDocumentMoney(order.allocatedValue)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono className="tabular-nums">
                    {order.coveragePercent == null
                      ? "—"
                      : `${order.coveragePercent.toFixed(1)}%`}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {onOpenSalesOrder ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                        data-testid={`output-document-detail-open-order-${order.salesOrderId}`}
                        onClick={() =>
                          onOpenSalesOrder(order.salesOrderId, order.orderCode)
                        }
                      >
                        Abrir pedido
                        <ExternalLink className="h-3 w-3 opacity-70" aria-hidden="true" />
                      </button>
                    ) : (
                      <DeepLink
                        href={buildOutputDocumentSalesOrderHref(order)}
                        label="Abrir pedido"
                      />
                    )}
                  </OverlayTable.Cell>
                </OverlayTable.Row>
              ))}
            </OverlayTable.Body>
          </OverlayTable>
        )}
      </OverlaySection>

      {detail.allocations.orderShares.length > 0 ? (
        <OverlaySection title="Participação no documento">
          <OverlayKpiCardGrid columns={3}>
            {detail.allocations.orderShares.map((share) => (
              <div key={share.salesOrderId}>
                <OverlayKpiCard
                  label={share.orderCode?.trim() || share.salesOrderId}
                  value={formatOutputDocumentMoney(share.allocatedValue)}
                  hint={
                    share.shareOfDocumentPercent == null
                      ? undefined
                      : `${share.shareOfDocumentPercent.toFixed(1)}% do documento`
                  }
                  tone="neutral"
                  size="sm"
                />
              </div>
            ))}
          </OverlayKpiCardGrid>
        </OverlaySection>
      ) : null}
    </div>
  );
}

function NfesPanel({ detail }: { detail: OutputDocumentDetailPayload }) {
  return (
    <div
      id="overlay-panel-nfes"
      role="tabpanel"
      className="space-y-4"
      data-testid="output-document-detail-nfes-panel"
    >
      <OverlaySection
        title="NF-e"
        description={`${detail.nfes.length} nota(s)`}
      >
        {detail.nfes.length === 0 ? (
          <EmptyBlock testId="output-document-detail-nfes-empty">
            Nenhuma NF-e vinculada a este documento.
          </EmptyBlock>
        ) : (
          <OverlayTable
            className="min-w-[1100px]"
            data-testid="output-document-detail-nfes-table"
          >
            <OverlayTable.Head>
              <OverlayTable.Row>
                {[
                  "Número",
                  "Série",
                  "Status",
                  "Emissão",
                  "Processamento",
                  "Valor",
                  "Chave",
                  "Cancelamento",
                  "Diferenças documentais",
                ].map((label) => (
                  <OverlayTable.HeadCell key={label}>{label}</OverlayTable.HeadCell>
                ))}
              </OverlayTable.Row>
            </OverlayTable.Head>
            <OverlayTable.Body>
              {detail.nfes.map((nfe) => (
                <OverlayTable.Row
                  key={nfe.externalId}
                  data-primary={nfe.isPrimary ? "true" : "false"}
                  data-testid={`output-document-detail-nfe-${nfe.externalId}`}
                >
                  <OverlayTable.Cell>
                    <DeepLink
                      href={buildOutputDocumentNfeSearchHref(nfe)}
                      label={nfe.numero?.trim() || String(nfe.externalId)}
                    />
                    {nfe.isPrimary ? (
                      <span className="ml-2 text-[10px] font-bold uppercase text-muted-foreground">
                        principal
                      </span>
                    ) : null}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentLabel(nfe.serie)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    <OverlayBadge tone={nfe.isCancelled ? "rose" : "emerald"}>
                      {formatOutputDocumentNfeStatusLabel(nfe)}
                    </OverlayBadge>
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentDate(nfe.dataEmissao)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentDate(nfe.dataProcessamento)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono className="tabular-nums">
                    {formatOutputDocumentMoney(nfe.totalValue)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono>
                    {formatOutputDocumentLabel(nfe.chaveMasked)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentNfeCancellation(nfe)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    <div className="max-w-[16rem]">
                      {formatOutputDocumentNfeDocumentaryDiffs(
                        nfe,
                        detail.inconsistencies
                      )}
                    </div>
                  </OverlayTable.Cell>
                </OverlayTable.Row>
              ))}
            </OverlayTable.Body>
          </OverlayTable>
        )}
      </OverlaySection>
    </div>
  );
}

function FinancialPanel({ detail }: { detail: OutputDocumentDetailPayload }) {
  if (!detail.permissions.canViewFinancial) {
    return (
      <EmptyBlock testId="output-document-detail-financial-denied">
        Você não possui permissão para ver o financeiro deste documento.
      </EmptyBlock>
    );
  }
  if (!detail.financial) {
    return (
      <EmptyBlock testId="output-document-detail-financial-empty">
        Sem informação financeira disponível para este documento.
      </EmptyBlock>
    );
  }
  const financial = detail.financial;
  const awaitingCr = financial.status === "aguardando_cr";
  return (
    <div
      id="overlay-panel-financeiro"
      role="tabpanel"
      className="space-y-4"
      data-testid="output-document-detail-financial-panel"
    >
      {awaitingCr ? (
        <div
          className="rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950"
          data-testid="output-document-detail-awaiting-cr"
          role="status"
        >
          {OUTPUT_DOCUMENT_AWAITING_CR_MESSAGE}
        </div>
      ) : null}
      <OverlaySection title="Situação financeira">
        <OverlayKpiCardGrid columns={4}>
          <OverlayKpiCard
            label="Status"
            value={formatOutputDocumentFinancialStatusLabel(financial.status)}
            tone="info"
            size="sm"
          />
          <OverlayKpiCard
            label="CR total"
            value={formatOutputDocumentMoney(financial.receivableTotal)}
            tone="neutral"
            size="sm"
          />
          <OverlayKpiCard
            label="Aberto"
            value={formatOutputDocumentMoney(financial.open)}
            tone={financial.open > 0 ? "warning" : "positive"}
            size="sm"
          />
          <OverlayKpiCard
            label="Recebido"
            value={formatOutputDocumentMoney(financial.received)}
            tone="positive"
            size="sm"
          />
        </OverlayKpiCardGrid>
        <DetailFieldGrid className="mt-4">
          <DetailField
            label="Próximo vencimento"
            value={formatOutputDocumentDate(financial.nextDueDate)}
          />
          <DetailField
            label="Parcelas"
            value={String(financial.installmentCount)}
          />
          <DetailField
            label="Origem"
            value={formatOutputDocumentLabel(financial.financialOrigin)}
          />
          <DetailField
            label="Condição do documento"
            value={formatOutputDocumentLabel(financial.documentPaymentTermsRaw)}
          />
        </DetailFieldGrid>
        {financial.alerts.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {financial.alerts.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
        ) : null}
      </OverlaySection>

      <OverlaySection title="Títulos">
        {financial.titles.length === 0 ? (
          <EmptyBlock testId="output-document-detail-financial-titles-empty">
            Nenhum título de CR vinculado.
          </EmptyBlock>
        ) : (
          <OverlayTable
            className="min-w-[880px]"
            data-testid="output-document-detail-financial-titles"
          >
            <OverlayTable.Head>
              <OverlayTable.Row>
                {["Título", "Vencimento", "Valor", "Aberto", "Recebido", "Status"].map(
                  (label) => (
                    <OverlayTable.HeadCell key={label}>{label}</OverlayTable.HeadCell>
                  )
                )}
              </OverlayTable.Row>
            </OverlayTable.Head>
            <OverlayTable.Body>
              {financial.titles.map((title) => (
                <OverlayTable.Row
                  key={`${title.receivableExternalId}-${title.dueDate ?? "nodue"}`}
                >
                  <OverlayTable.Cell mono>
                    {String(title.receivableExternalId)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentDate(title.dueDate)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono className="tabular-nums">
                    {formatOutputDocumentMoney(title.amountReceivable)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono className="tabular-nums">
                    {formatOutputDocumentMoney(title.balanceReceivable)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell mono className="tabular-nums">
                    {formatOutputDocumentMoney(title.amountReceived)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {formatOutputDocumentLabel(
                      `${title.settlement}${title.dueStatus ? ` · ${title.dueStatus}` : ""}`
                    )}
                  </OverlayTable.Cell>
                </OverlayTable.Row>
              ))}
            </OverlayTable.Body>
          </OverlayTable>
        )}
      </OverlaySection>
    </div>
  );
}

function AuditPanel({ detail }: { detail: OutputDocumentDetailPayload }) {
  if (!detail.permissions.canViewAudit) {
    return (
      <EmptyBlock testId="output-document-detail-audit-denied">
        Você não possui permissão para ver a auditoria deste documento.
      </EmptyBlock>
    );
  }
  if (!detail.audit) {
    return (
      <EmptyBlock testId="output-document-detail-audit-empty">
        Auditoria indisponível para este documento.
      </EmptyBlock>
    );
  }
  const audit = detail.audit;
  return (
    <div
      id="overlay-panel-auditoria"
      role="tabpanel"
      className="space-y-4"
      data-testid="output-document-detail-audit-panel"
    >
      <OverlaySection title="IDs externos">
        <DetailFieldGrid>
          <DetailField label="Documento ID" value={audit.stockDocumentId} />
          <DetailField
            label="External ID"
            value={String(audit.stockDocumentExternalId)}
          />
          <DetailField
            label="idNfe"
            value={audit.idNfe == null ? "—" : String(audit.idNfe)}
          />
        </DetailFieldGrid>
      </OverlaySection>
      <OverlaySection title="Sincronização e presença">
        <DetailFieldGrid>
          <DetailField
            label="Hash do payload"
            value={formatOutputDocumentLabel(audit.payloadHash)}
          />
          <DetailField
            label="Primeira vista"
            value={formatOutputDocumentDateTime(audit.firstSeenAt)}
          />
          <DetailField
            label="Última vista"
            value={formatOutputDocumentDateTime(audit.lastSeenAt)}
          />
          <DetailField
            label="Presente no último payload"
            value={audit.presentInLastPayload ? "Sim" : "Não"}
          />
          <DetailField
            label="Última sincronização"
            value={formatOutputDocumentDateTime(audit.syncedAt)}
          />
        </DetailFieldGrid>
      </OverlaySection>
      <OverlaySection title="Origem dos vínculos">
        <DetailFieldGrid>
          <DetailField
            label="NF-e"
            value={`${audit.nfeLink.classification} · ${audit.nfeLink.sources.join(", ") || "—"}`}
          />
          <DetailField
            label="Pedidos"
            value={`${audit.ordersLink.classification} · ${audit.ordersLink.sources.join(", ") || "—"}`}
          />
          <DetailField
            label="CR"
            value={`${audit.receivablesLink.classification} · ${audit.receivablesLink.sources.join(", ") || "—"}`}
          />
          <DetailField
            label="O2C"
            value={
              audit.o2cPresent
                ? `Sim · ${audit.o2cRunIds.length} run(s)`
                : "Não materializado"
            }
          />
        </DetailFieldGrid>
        {audit.conflicts.length > 0 ? (
          <ul
            className="mt-3 list-disc space-y-1 pl-5 text-sm text-rose-800"
            data-testid="output-document-detail-audit-conflicts"
          >
            {audit.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        ) : null}
      </OverlaySection>
      <OverlaySection title="Raw JSON">
        {detail.permissions.canViewRaw && detail.raw ? (
          <div
            className="space-y-3"
            data-testid="output-document-detail-raw-json"
          >
            <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 text-xs">
              {JSON.stringify(detail.raw.document, null, 2)}
            </pre>
            <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-background p-3 text-xs">
              {JSON.stringify(detail.raw.items, null, 2)}
            </pre>
          </div>
        ) : (
          <EmptyBlock testId="output-document-detail-raw-denied">
            Raw JSON disponível somente com permissão específica
            (commercial.output_documents.raw).
          </EmptyBlock>
        )}
      </OverlaySection>
    </div>
  );
}

function OutputDocumentItemsTable({
  items,
  onOpenSalesOrder,
}: {
  items: ReadonlyArray<OutputDocumentDetailItem>;
  onOpenSalesOrder?: (salesOrderId: string, orderCode?: string | null) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyBlock testId="output-document-detail-items-empty">
        Este Documento de Saída não possui itens no stage.
      </EmptyBlock>
    );
  }

  return (
    <OverlayTable
      className="min-w-[1100px]"
      data-testid="output-document-detail-items-table"
    >
      <OverlayTable.Head>
        <OverlayTable.Row>
          {[
            "SKU",
            "Descrição",
            "Quantidade",
            "Unidade",
            "Valor unitário",
            "Valor total",
            "Pedido",
            "Item do pedido",
            "Produto local",
            "Estado do vínculo",
          ].map((label) => (
            <OverlayTable.HeadCell key={label}>{label}</OverlayTable.HeadCell>
          ))}
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {items.map((item) => (
          <OverlayTable.Row
            key={item.id}
            data-testid={`output-document-detail-item-${item.id}`}
            data-link-status={item.linkStatus}
          >
            <OverlayTable.Cell mono>
              {formatOutputDocumentItemSkuLabel(item)}
            </OverlayTable.Cell>
            <OverlayTable.Cell>
              <div className="max-w-[16rem]">
                {formatOutputDocumentItemDescription(item)}
              </div>
            </OverlayTable.Cell>
            <OverlayTable.Cell mono className="tabular-nums">
              {formatQuantity(item.quantity)}
            </OverlayTable.Cell>
            <OverlayTable.Cell mono>
              {formatOutputDocumentItemUnit(item)}
            </OverlayTable.Cell>
            <OverlayTable.Cell mono className="tabular-nums">
              {formatOutputDocumentMoney(item.unitValue)}
            </OverlayTable.Cell>
            <OverlayTable.Cell mono className="tabular-nums">
              {formatOutputDocumentMoney(item.totalValue)}
            </OverlayTable.Cell>
            <OverlayTable.Cell>
              {item.links[0]?.salesOrderId ? (
                onOpenSalesOrder ? (
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() =>
                      onOpenSalesOrder(
                        item.links[0]!.salesOrderId!,
                        item.links[0]!.orderCode
                      )
                    }
                  >
                    {formatOutputDocumentItemOrder(item)}
                  </button>
                ) : (
                  <DeepLink
                    href={buildOutputDocumentSalesOrderHref({
                      salesOrderId: item.links[0].salesOrderId,
                      orderCode: item.links[0].orderCode,
                    })}
                    label={formatOutputDocumentItemOrder(item)}
                  />
                )
              ) : (
                formatOutputDocumentItemOrder(item)
              )}
            </OverlayTable.Cell>
            <OverlayTable.Cell mono>
              {formatOutputDocumentItemOrderItem(item)}
            </OverlayTable.Cell>
            <OverlayTable.Cell>
              {formatOutputDocumentItemLocalProduct(item)}
            </OverlayTable.Cell>
            <OverlayTable.Cell>
              <OverlayBadge tone={outputDocumentItemLinkStatusTone(item.linkStatus)}>
                {formatOutputDocumentItemLinkStatusLabel(item.linkStatus)}
              </OverlayBadge>
            </OverlayTable.Cell>
          </OverlayTable.Row>
        ))}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

function DeepLink({ href, label }: { href: string; label: string }) {
  if (!href || !label || label === "—") return <>{label || "—"}</>;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      onClick={(event) => event.stopPropagation()}
    >
      <span>{label}</span>
      <ExternalLink className="h-3 w-3 opacity-70" aria-hidden="true" />
    </a>
  );
}

function DetailFieldGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <dl
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${className ?? ""}`}
    >
      {children}
    </dl>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-foreground">
        {value == null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function EmptyBlock({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}) {
  return (
    <p
      className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

function DrawerState({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
      data-testid={testId}
      role="status"
    >
      {children}
    </div>
  );
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 6,
  }).format(value);
}
