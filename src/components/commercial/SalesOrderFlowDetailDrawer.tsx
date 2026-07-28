import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Copy, Loader2, RefreshCw } from "lucide-react";
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
import {
  fetchSalesOrderFlowDetail,
  fetchSalesOrderFlowEvents,
  recomputeSalesOrderFlowOrder,
  type SalesOrderFlowDetailPayload,
  type SalesOrderFlowEventsPayload,
  type SalesOrderFlowManagementApi,
} from "@/src/lib/salesOrderFlowClient";
import {
  classifySalesOrderFlowDetailError,
  classifySalesOrderFlowRecomputeError,
  dedupeSalesOrderFlowDetailEventsByKey,
  filterSalesOrderFlowDetailInconsistencyRows,
  formatSalesOrderFlowDetailDate,
  formatSalesOrderFlowDetailDays,
  formatSalesOrderFlowDetailMoney,
  formatSalesOrderFlowDetailPercent,
  formatSalesOrderFlowDetailQuantity,
  formatSalesOrderFlowEventTypeLabel,
  formatSalesOrderFlowInconsistencyLabel,
  formatSalesOrderFlowInconsistencySeverityLabel,
  formatSalesOrderFlowStageLabel,
  resolveSalesOrderFlowDetailAvailableTabs,
  resolveSalesOrderFlowDetailDaysInStage,
  resolveSalesOrderFlowDetailEventView,
  resolveSalesOrderFlowDetailHeaderLinks,
  resolveSalesOrderFlowDetailInconsistencyRows,
  resolveSalesOrderFlowDetailItems,
  resolveSalesOrderFlowDetailNavigationCapabilities,
  resolveSalesOrderFlowDetailShipmentViews,
  resolveSalesOrderFlowManagementUiCapabilities,
  salesOrderFlowInconsistencySeverityClassName,
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES,
  SALES_ORDER_FLOW_MANAGEMENT_AREA_OPTIONS,
  type SalesOrderFlowDetailTab,
  type SalesOrderFlowManagementUiCapabilities,
} from "@/src/lib/salesOrderFlowDetailUi";
import { SALES_ORDER_FLOW_EVENT_TYPES } from "@/src/lib/sales/salesOrderFlowTimeline.shared";
import { SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS } from "@/src/lib/sales/salesOrderFlowOperationalDiagnostics.shared";
import { SalesOrderFlowManagementPanel } from "@/src/components/commercial/SalesOrderFlowManagementPanel";
import { usePermissions } from "@/src/hooks/usePermissions";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  salesOrderId: string | null;
  orderCode?: string | null;
  onClose: () => void;
  onOrderCodeResolved?: (orderCode: string) => void;
  onRecomputed?: (result: {
    salesOrderId: string;
    currentOrderStage: string;
  }) => void;
  onManagementUpdated?: (update: {
    salesOrderId: string;
    management: SalesOrderFlowManagementApi;
  }) => void;
  managementCapabilities?: SalesOrderFlowManagementUiCapabilities;
};

/**
 * Drawer largo do Fluxo de Pedidos (OP-69/OP-72): evidências, timeline,
 * inconsistências e ações de gestão. Overlay canônico; preserva filtros do Kanban.
 */
export function SalesOrderFlowDetailDrawer({
  open,
  salesOrderId,
  orderCode,
  onClose,
  onOrderCodeResolved,
  onRecomputed,
  onManagementUpdated,
  managementCapabilities: managementCapabilitiesProp,
}: Props) {
  const permissions = usePermissions();
  const managementCapabilities = useMemo(
    () =>
      managementCapabilitiesProp ??
      resolveSalesOrderFlowManagementUiCapabilities(
        permissions.canPerformAction
      ),
    [managementCapabilitiesProp, permissions.canPerformAction]
  );
  const navigationCapabilities = useMemo(
    () =>
      resolveSalesOrderFlowDetailNavigationCapabilities({
        canPerformAction: permissions.canPerformAction,
        canViewModule: permissions.canViewModule,
      }),
    [permissions.canPerformAction, permissions.canViewModule]
  );
  const [detail, setDetail] = useState<SalesOrderFlowDetailPayload | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<
    "not_found" | "access_denied" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SalesOrderFlowDetailTab>("resumo");
  const [retryToken, setRetryToken] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !salesOrderId) {
      setDetail(null);
      setErrorKind(null);
      setErrorMessage(null);
      setActiveTab("resumo");
      setLoading(false);
      setCopyFeedback(null);
      setRecomputeMessage(null);
      setRecomputeError(null);
      return;
    }
    setCopyFeedback(null);
    setRecomputeMessage(null);
    setRecomputeError(null);
    setActiveTab("resumo");
  }, [open, salesOrderId]);

  useEffect(() => {
    if (!open || !salesOrderId) return;
    const controller = new AbortController();
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);
    void fetchSalesOrderFlowDetail(salesOrderId, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        setDetail(payload);
        const code = payload.order.orderCode?.trim();
        if (code) onOrderCodeResolved?.(code);
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        const classified = classifySalesOrderFlowDetailError(cause);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // onOrderCodeResolved é opcional e não deve reabrir o fetch em loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, salesOrderId, retryToken]);

  const items = useMemo(
    () => (detail ? resolveSalesOrderFlowDetailItems(detail) : []),
    [detail]
  );
  const shipment = useMemo(
    () => (detail ? resolveSalesOrderFlowDetailShipmentViews(detail) : null),
    [detail]
  );
  const tabs = useMemo(
    () => resolveSalesOrderFlowDetailAvailableTabs(detail),
    [detail]
  );
  const headerLinks = useMemo(
    () =>
      detail
        ? resolveSalesOrderFlowDetailHeaderLinks(detail, navigationCapabilities)
        : [],
    [detail, navigationCapabilities]
  );
  const titleId = "sales-order-flow-detail-title";
  const displayCode =
    detail?.order.orderCode ?? orderCode?.trim() ?? "Pedido";

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("resumo");
    }
  }, [tabs, activeTab]);

  async function handleCopyOrderCode() {
    const code = displayCode.trim();
    if (!code || code === "Pedido") return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyFeedback("Código copiado");
      window.setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback("Não foi possível copiar");
      window.setTimeout(() => setCopyFeedback(null), 2000);
    }
  }

  async function handleRecompute() {
    if (!salesOrderId || !navigationCapabilities.canExecuteRecompute) return;
    setRecomputing(true);
    setRecomputeError(null);
    setRecomputeMessage(null);
    try {
      const result = await recomputeSalesOrderFlowOrder(salesOrderId);
      setRecomputeMessage(
        result.action === "unchanged"
          ? "Pedido já estava atualizado."
          : "Pedido atualizado com sucesso."
      );
      onRecomputed?.({
        salesOrderId: result.salesOrderId,
        currentOrderStage: result.currentOrderStage,
      });
      setRetryToken((token) => token + 1);
    } catch (cause: unknown) {
      const classified = classifySalesOrderFlowRecomputeError(cause);
      setRecomputeError(classified.message);
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <Overlay
      open={open && salesOrderId != null}
      onClose={onClose}
      size="full"
      ariaLabelledBy={titleId}
      ariaDescribedBy="sales-order-flow-detail-description"
      testId="sales-order-flow-detail-drawer"
      className="h-[calc(100vh-2rem)] !max-w-[1400px] sm:h-[92vh]"
    >
      <OverlayHeader
        titleId={titleId}
        eyebrow="Comercial · Fluxo de Pedidos"
        title={`Pedido ${displayCode}`}
        subtitle={
          <span id="sales-order-flow-detail-description">
            {detail
              ? `${detail.order.customerName ?? "Cliente não informado"} · ${formatSalesOrderFlowStageLabel(detail.columnExplanation.stage)}`
              : "Consulta operacional somente leitura"}
          </span>
        }
        actions={
          <div
            className="flex max-w-[min(100%,42rem)] flex-col items-end gap-1.5"
            data-testid="sales-order-flow-detail-nav"
          >
            {detail ? (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <OverlayBadge tone="sky" emphasized>
                  {formatSalesOrderFlowStageLabel(detail.columnExplanation.stage)}
                </OverlayBadge>
                {detail.management?.isBlocked ? (
                  <OverlayBadge tone="rose">Bloqueado</OverlayBadge>
                ) : null}
                {detail.shipmentDates?.isOverdue ? (
                  <OverlayBadge tone="amber">Atrasado</OverlayBadge>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                className={HEADER_ACTION_BTN}
                onClick={onClose}
                data-testid="sales-order-flow-detail-back-kanban"
              >
                Voltar ao Kanban
              </button>
              <button
                type="button"
                className={HEADER_ACTION_BTN}
                onClick={() => void handleCopyOrderCode()}
                disabled={!displayCode || displayCode === "Pedido"}
                data-testid="sales-order-flow-detail-copy-code"
                title="Copiar código do pedido"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                Copiar
              </button>
              {navigationCapabilities.canExecuteRecompute ? (
                <button
                  type="button"
                  className={HEADER_ACTION_BTN}
                  onClick={() => void handleRecompute()}
                  disabled={recomputing || !salesOrderId || loading}
                  data-testid="sales-order-flow-detail-recompute"
                  title="Recomputar snapshot do pedido"
                >
                  <RefreshCw
                    className={cn("h-3 w-3", recomputing && "animate-spin")}
                    aria-hidden="true"
                  />
                  {recomputing ? "Atualizando…" : "Atualizar"}
                </button>
              ) : null}
              {headerLinks.map((link) => (
                <Link
                  key={link.id}
                  to={link.href}
                  className={HEADER_ACTION_BTN}
                  data-testid={link.testId}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            {copyFeedback || recomputeMessage || recomputeError ? (
              <div className="flex flex-wrap justify-end gap-2 text-[11px]">
                {copyFeedback ? (
                  <span
                    className="text-muted-foreground"
                    aria-live="polite"
                    data-testid="sales-order-flow-detail-copy-feedback"
                  >
                    {copyFeedback}
                  </span>
                ) : null}
                {recomputeMessage ? (
                  <span
                    className="text-emerald-700"
                    aria-live="polite"
                    data-testid="sales-order-flow-detail-recompute-ok"
                  >
                    {recomputeMessage}
                  </span>
                ) : null}
                {recomputeError ? (
                  <span
                    className="text-destructive"
                    role="alert"
                    data-testid="sales-order-flow-detail-recompute-error"
                  >
                    {recomputeError}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        onClose={onClose}
        closeLabel="Fechar"
        density="default"
        className="!items-start !py-3"
      />
      <OverlayTabs
        tabs={tabs}
        active={activeTab}
        onChange={setActiveTab}
        variant="pill"
        testId="sales-order-flow-detail-tabs"
        ariaLabel="Seções do detalhe do Fluxo de Pedidos"
      />
      <OverlayBody className="bg-[#f8fafc] px-3 py-3 sm:px-4">
        {loading ? (
          <DrawerState testId="sales-order-flow-detail-loading">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando detalhe do fluxo…
          </DrawerState>
        ) : null}

        {!loading && errorMessage ? (
          <div
            role="alert"
            className={
              errorKind === "not_found"
                ? "rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-950"
                : errorKind === "access_denied"
                  ? "rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-950"
                  : "rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            }
            data-testid={
              errorKind === "not_found"
                ? "sales-order-flow-detail-not-found"
                : errorKind === "access_denied"
                  ? "sales-order-flow-detail-denied"
                  : "sales-order-flow-detail-error"
            }
          >
            <p>{errorMessage}</p>
            {errorKind !== "access_denied" && errorKind !== "not_found" ? (
              <button
                type="button"
                className="mt-3 inline-flex rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
                data-testid="sales-order-flow-detail-retry"
                onClick={() => setRetryToken((token) => token + 1)}
              >
                Tentar novamente
              </button>
            ) : null}
          </div>
        ) : null}

        {!loading && !errorMessage && detail && shipment ? (
          <SalesOrderFlowDetailContent
            detail={detail}
            items={items}
            shipment={shipment}
            activeTab={activeTab}
            salesOrderId={salesOrderId}
            managementCapabilities={managementCapabilities}
            onDetailManagementChange={(management) => {
              setDetail((current) =>
                current ? { ...current, management } : current
              );
              if (salesOrderId) {
                onManagementUpdated?.({ salesOrderId, management });
              }
            }}
            onConflictReload={async () => {
              if (!salesOrderId) return;
              const payload = await fetchSalesOrderFlowDetail(salesOrderId);
              setDetail(payload);
            }}
          />
        ) : null}
      </OverlayBody>
    </Overlay>
  );
}

export function SalesOrderFlowDetailContent({
  detail,
  items,
  shipment,
  activeTab,
  salesOrderId,
  managementCapabilities,
  onDetailManagementChange,
  onConflictReload,
}: {
  detail: SalesOrderFlowDetailPayload;
  items: ReturnType<typeof resolveSalesOrderFlowDetailItems>;
  shipment: ReturnType<typeof resolveSalesOrderFlowDetailShipmentViews>;
  activeTab: SalesOrderFlowDetailTab;
  salesOrderId?: string | null;
  managementCapabilities?: SalesOrderFlowManagementUiCapabilities;
  onDetailManagementChange?: (
    management: SalesOrderFlowManagementApi
  ) => void;
  onConflictReload?: () => Promise<void>;
}) {
  if (activeTab === "itens") {
    return <ItemsTab detail={detail} items={items} />;
  }
  if (activeTab === "producao") {
    return <ProductionTab shipment={shipment} />;
  }
  if (activeTab === "documentos") {
    return (
      <DocumentsTab
        shipment={shipment}
        valuesVisible={detail.valuesVisible}
      />
    );
  }
  if (activeTab === "nfe_envio") {
    return (
      <NfeShipmentTab
        shipment={shipment}
        valuesVisible={detail.valuesVisible}
      />
    );
  }
  if (activeTab === "timeline") {
    return (
      <TimelineTab
        salesOrderId={salesOrderId ?? detail.salesOrderId}
        items={items}
        timelineVisible={detail.timelineVisible}
      />
    );
  }
  if (activeTab === "inconsistencias") {
    return <InconsistenciesTab detail={detail} items={items} />;
  }
  return (
    <SummaryTab
      detail={detail}
      managementCapabilities={
        managementCapabilities ?? {
          canUpdateManually: false,
          canChangePriority: false,
          canAssignResponsible: false,
          canManageBlocking: false,
        }
      }
      onDetailManagementChange={onDetailManagementChange}
      onConflictReload={onConflictReload}
    />
  );
}

function SummaryTab({
  detail,
  managementCapabilities,
  onDetailManagementChange,
  onConflictReload,
}: {
  detail: SalesOrderFlowDetailPayload;
  managementCapabilities: SalesOrderFlowManagementUiCapabilities;
  onDetailManagementChange?: (
    management: SalesOrderFlowManagementApi
  ) => void;
  onConflictReload?: () => Promise<void>;
}) {
  const daysInStage = resolveSalesOrderFlowDetailDaysInStage(detail);
  const valuesVisible = detail.valuesVisible;
  const financial = detail.financialSituation;
  const responsibleAreaLabel = formatResponsibleAreaLabel(
    detail.responsibleArea ?? detail.columnExplanation.responsibleArea
  );

  return (
    <div
      className="space-y-3"
      id="overlay-panel-resumo"
      role="tabpanel"
      data-testid="sales-order-flow-detail-summary"
    >
      <OverlaySection title="Identificação" className="!rounded-xl">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          <FlatField label="Cliente" value={detail.order.customerName} />
          <FlatField label="Vendedor" value={detail.order.sellerName} />
          <FlatField label="Empresa" value={detail.order.companyIssuer} />
          <FlatField
            label="Emissão"
            value={formatSalesOrderFlowDetailDate(detail.order.issueDate)}
          />
          <FlatField
            label="Entrega prometida"
            value={formatSalesOrderFlowDetailDate(
              detail.shipmentDates?.promisedDeliveryAt ??
                detail.order.expectedDeliveryDate
            )}
          />
          <FlatField
            label="Dias na etapa"
            value={formatSalesOrderFlowDetailDays(daysInStage)}
          />
        </dl>
      </OverlaySection>

      <OverlaySection title="Indicadores" className="!rounded-xl">
        <OverlayKpiCardGrid columns={5} className="!gap-2">
          <OverlayKpiCard
            size="sm"
            className="!border-l-[3px] !border-l-slate-400 !p-2"
            label="Valor do pedido"
            value={formatSalesOrderFlowDetailMoney(
              financial?.orderValue,
              valuesVisible
            )}
          />
          <OverlayKpiCard
            size="sm"
            className="!border-l-[3px] !border-l-sky-500 !p-2"
            label="Saldo ativo"
            value={formatSalesOrderFlowDetailMoney(
              financial?.activeResidualValue,
              valuesVisible
            )}
          />
          <OverlayKpiCard
            size="sm"
            className="!border-l-[3px] !border-l-violet-500 !p-2"
            label="OP"
            value={formatSalesOrderFlowDetailPercent(
              detail.progress?.productionOrder
            )}
          />
          <OverlayKpiCard
            size="sm"
            className="!border-l-[3px] !border-l-amber-500 !p-2"
            label="Documentado"
            value={formatSalesOrderFlowDetailPercent(
              detail.progress?.documented
            )}
          />
          <OverlayKpiCard
            size="sm"
            className="!border-l-[3px] !border-l-emerald-500 !p-2"
            label="Faturado / Enviado"
            value={`${formatSalesOrderFlowDetailPercent(detail.progress?.invoiced)} · ${formatSalesOrderFlowDetailPercent(detail.progress?.shipped)}`}
          />
        </OverlayKpiCardGrid>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          <FlatField
            label="Valor cortado"
            value={formatSalesOrderFlowDetailMoney(
              financial?.cutValue,
              valuesVisible
            )}
          />
          <FlatField
            label="Valor cancelado"
            value={formatSalesOrderFlowDetailMoney(
              financial?.canceledValue,
              valuesVisible
            )}
          />
          <FlatField
            label="Valor atendido"
            value={formatSalesOrderFlowDetailMoney(
              financial?.fulfilledValue,
              valuesVisible
            )}
          />
          <FlatField
            label="Produzido"
            value={formatSalesOrderFlowDetailPercent(detail.progress?.produced)}
          />
          <FlatField
            label="Inconsistências"
            value={
              detail.inconsistenciesVisible
                ? String(detail.inconsistencies.length)
                : "—"
            }
          />
        </dl>
      </OverlaySection>

      <OverlaySection title="Situação operacional" className="!rounded-xl">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
          <FlatField
            label="Pedido"
            value={detail.order.orderCode}
          />
          <FlatField
            label="Etapa"
            value={formatSalesOrderFlowStageLabel(detail.columnExplanation.stage)}
          />
          <FlatField label="Área responsável" value={responsibleAreaLabel} />
          <FlatField
            label="Por que está nesta coluna"
            value={detail.columnExplanation.reason}
            className="sm:col-span-2 xl:col-span-3"
          />
          <FlatField
            label="Próxima ação"
            value={detail.nextAction ?? detail.columnExplanation.nextAction}
            className="sm:col-span-2"
          />
          <FlatField
            label="Gargalo"
            value={
              detail.bottleneck
                ? [
                    formatSalesOrderFlowStageLabel(detail.bottleneck.stage),
                    detail.bottleneck.reason,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"
                : "—"
            }
            className="sm:col-span-2 xl:col-span-3"
          />
          <FlatField
            label="Obrigação ativa"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.activeObligation
            )}
          />
          <FlatField
            label="Quantidade atendida"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.fulfilledQuantity
            )}
          />
          <FlatField
            label="Saldo"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.remainingFulfillment
            )}
          />
          <FlatField
            label="Corte"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.cutQuantity
            )}
          />
          <FlatField
            label="Cancelamento"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.canceledQuantity
            )}
          />
          <FlatField
            label="Envio"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.shippedQuantity
            )}
          />
          <FlatField
            label="OPs vinculadas"
            value={
              detail.operationalDiagnostics
                ? detail.operationalDiagnostics.productionOrderLabels.length > 0
                  ? detail.operationalDiagnostics.productionOrderLabels.join(", ")
                  : "Nenhuma"
                : "—"
            }
            className="sm:col-span-2"
          />
          <FlatField
            label="Cobertura das OPs"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.productionOrderQuantity
            )}
          />
          <FlatField
            label="Documentos de Saída"
            value={
              detail.operationalDiagnostics
                ? detail.operationalDiagnostics.outputDocumentLabels.length > 0
                  ? detail.operationalDiagnostics.outputDocumentLabels.join(", ")
                  : "Nenhum"
                : "—"
            }
            className="sm:col-span-2"
          />
          <FlatField
            label="Quantidade documentada"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.documentedQuantity
            )}
          />
          <FlatField
            label="NF-e"
            value={
              detail.operationalDiagnostics
                ? detail.operationalDiagnostics.nfeLabels.length > 0
                  ? detail.operationalDiagnostics.nfeLabels.join(", ")
                  : "Nenhuma"
                : "—"
            }
            className="sm:col-span-2"
          />
          <FlatField
            label="Quantidade faturada"
            value={formatSalesOrderFlowDetailQuantity(
              detail.operationalDiagnostics?.totals.invoicedQuantity
            )}
          />
        </dl>
        {detail.badges.length > 0 ? (
          <div
            className="mt-3 flex flex-wrap gap-1.5"
            data-testid="sales-order-flow-detail-badges"
          >
            {detail.badges.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground"
              >
                {formatSalesOrderFlowBadgeLabel(badge)}
              </span>
            ))}
          </div>
        ) : null}
      </OverlaySection>

      <OperationalDiagnosticsPanel detail={detail} />

      <SalesOrderFlowManagementPanel
        detail={detail}
        capabilities={managementCapabilities}
        onManagementSaved={(management) => {
          onDetailManagementChange?.(management);
        }}
        onConflictReload={async () => {
          await onConflictReload?.();
        }}
      />
    </div>
  );
}

function ItemsTab({
  detail,
  items,
}: {
  detail: SalesOrderFlowDetailPayload;
  items: ReturnType<typeof resolveSalesOrderFlowDetailItems>;
}) {
  return (
    <div
      id="overlay-panel-itens"
      role="tabpanel"
      data-testid="sales-order-flow-detail-items"
    >
      <OverlaySection
        title="Itens do pedido"
        description="Itens inconsistentes permanecem visíveis na lista."
        className="!rounded-xl"
      >
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-background/70 p-6 text-center text-sm text-muted-foreground">
            Nenhum item materializado no snapshot do fluxo.
          </p>
        ) : (
          <OverlayTable
            className="text-[11px] [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-[#1e3a8a]"
          >
            <thead className="bg-slate-50">
              <tr>
                <th>Produto</th>
                <th>Qtd. pedida</th>
                <th>OP</th>
                <th>Produzido</th>
                <th>Documentado</th>
                <th>Faturado</th>
                <th>Enviado</th>
                <th>Saldo ativo</th>
                <th>Corte</th>
                <th>Etapa</th>
                <th>Próxima ação</th>
                <th>Evidência</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.salesOrderItemId}
                  data-testid={`sales-order-flow-detail-item-${item.salesOrderItemId}`}
                  className={cn(
                    item.isInconsistent && "bg-amber-50/70"
                  )}
                >
                  <td>
                    <div className="font-medium text-foreground">
                      {item.productLabel}
                    </div>
                    {item.isInconsistent ? (
                      <div className="mt-0.5 text-[10px] text-amber-800">
                        Inconsistente
                        {detail.inconsistenciesVisible
                          ? `: ${item.inconsistencies
                              .map((row) =>
                                formatSalesOrderFlowInconsistencyLabel(row.code)
                              )
                              .join(", ")}`
                          : null}
                      </div>
                    ) : null}
                  </td>
                  <td>{formatSalesOrderFlowDetailQuantity(item.orderedQuantity)}</td>
                  <td>
                    {formatSalesOrderFlowDetailPercent(
                      item.progressProductionOrder
                    )}
                  </td>
                  <td>
                    {formatSalesOrderFlowDetailPercent(item.progressProduced)}
                  </td>
                  <td>
                    {formatSalesOrderFlowDetailPercent(item.progressDocumented)}
                  </td>
                  <td>
                    {formatSalesOrderFlowDetailPercent(item.progressInvoiced)}
                  </td>
                  <td>
                    {formatSalesOrderFlowDetailPercent(item.progressShipped)}
                  </td>
                  <td>
                    {formatSalesOrderFlowDetailQuantity(
                      item.activeRemainingQuantity
                    )}
                  </td>
                  <td>
                    {formatSalesOrderFlowDetailQuantity(item.cutQuantity)}
                  </td>
                  <td>{item.stageLabel}</td>
                  <td>{item.nextAction?.trim() || "—"}</td>
                  <td title={item.fulfillmentClassification ?? undefined}>
                    {item.fulfillmentClassificationLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </OverlayTable>
        )}
      </OverlaySection>
    </div>
  );
}

function ProductionTab({
  shipment,
}: {
  shipment: ReturnType<typeof resolveSalesOrderFlowDetailShipmentViews>;
}) {
  return (
    <div
      id="overlay-panel-producao"
      role="tabpanel"
      data-testid="sales-order-flow-detail-production"
      className="space-y-4"
    >
      <OverlaySection title="Ordens de Produção">
        {shipment.production.length === 0 ? (
          <EmptyPanel text="Nenhuma OP vinculada oficialmente a este pedido." />
        ) : (
          <OverlayTable>
            <thead>
              <tr>
                <th>OP</th>
                <th>Status</th>
                <th>Produto</th>
                <th>Qtd. vinculada</th>
                <th>Planejado</th>
                <th>Produzido</th>
                <th>Abertura</th>
                <th>Fechamento</th>
                <th>Vínculo</th>
                <th>Inconsistências</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {shipment.production.map((op) => (
                <tr key={op.id} data-testid={`sales-order-flow-detail-op-${op.id}`}>
                  <td className="font-medium">{op.label}</td>
                  <td>{op.status?.trim() || "—"}</td>
                  <td>{op.productCode?.trim() || "—"}</td>
                  <td>{formatSalesOrderFlowDetailQuantity(op.linkedQuantity)}</td>
                  <td>{formatSalesOrderFlowDetailQuantity(op.plannedQuantity)}</td>
                  <td>{formatSalesOrderFlowDetailQuantity(op.producedQuantity)}</td>
                  <td>{formatSalesOrderFlowDetailDate(op.openedAt)}</td>
                  <td>{formatSalesOrderFlowDetailDate(op.closedAt)}</td>
                  <td>
                    {op.linkCount > 0
                      ? `${op.linkCount}${op.isCurrentLink ? " · vigente" : ""}`
                      : "—"}
                  </td>
                  <td>
                    {op.inconsistencies.length > 0
                      ? op.inconsistencies
                          .map((row) => row.detail || row.code)
                          .join(" · ")
                      : "—"}
                  </td>
                  <td>
                    <a
                      href={op.href}
                      className="text-primary underline-offset-2 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir OP
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </OverlayTable>
        )}
      </OverlaySection>
    </div>
  );
}

function DocumentsTab({
  shipment,
  valuesVisible,
}: {
  shipment: ReturnType<typeof resolveSalesOrderFlowDetailShipmentViews>;
  valuesVisible: boolean;
}) {
  return (
    <div
      id="overlay-panel-documentos"
      role="tabpanel"
      data-testid="sales-order-flow-detail-documents"
      className="space-y-4"
    >
      <OverlaySection
        title="Documentos de Saída ativos"
        description={`${shipment.activeDocumentCount} documento(s) contados (cancelados excluídos).`}
      >
        {shipment.documentsActive.length === 0 ? (
          <EmptyPanel text="Nenhum documento de saída ativo vinculado." />
        ) : (
          <DocumentTable
            rows={shipment.documentsActive}
            valuesVisible={valuesVisible}
          />
        )}
      </OverlaySection>
      {shipment.documentsCanceled.length > 0 ? (
        <OverlaySection
          title="Documentos cancelados (não contados)"
          description={`${shipment.documentsCanceled.length} documento(s) cancelados excluídos dos totais.`}
        >
          <DocumentTable
            rows={shipment.documentsCanceled}
            valuesVisible={valuesVisible}
          />
        </OverlaySection>
      ) : null}
    </div>
  );
}

function DocumentTable({
  rows,
  valuesVisible,
}: {
  rows: ReturnType<
    typeof resolveSalesOrderFlowDetailShipmentViews
  >["documentsActive"];
  valuesVisible: boolean;
}) {
  return (
    <OverlayTable>
      <thead>
        <tr>
          <th>Documento</th>
          <th>Status</th>
          <th>Data</th>
          <th>Qtd. itens</th>
          <th>Qtd. alocada</th>
          <th>Valor</th>
          <th>Itens</th>
          <th>Alocações</th>
          <th>Cancelamento</th>
          <th>Link</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((doc) => (
          <tr
            key={doc.id}
            data-testid={`sales-order-flow-detail-doc-${doc.id}`}
            className={cn(doc.isCancelled && "bg-rose-50/60")}
          >
            <td className="font-medium">{doc.label}</td>
            <td>{doc.statusRaw?.trim() || "—"}</td>
            <td>{formatSalesOrderFlowDetailDate(doc.dataDocumento)}</td>
            <td>{formatSalesOrderFlowDetailQuantity(doc.itemQuantity)}</td>
            <td>{formatSalesOrderFlowDetailQuantity(doc.allocatedQuantity)}</td>
            <td>
              {formatSalesOrderFlowDetailMoney(doc.totalValue, valuesVisible)}
            </td>
            <td>{doc.itemCount}</td>
            <td>{doc.allocationCount}</td>
            <td>
              {doc.isCancelled
                ? doc.cancellationReason?.trim() || "Cancelado"
                : "—"}
            </td>
            <td>
              <a
                href={doc.href}
                className="text-primary underline-offset-2 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Abrir DS
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </OverlayTable>
  );
}

function NfeShipmentTab({
  shipment,
  valuesVisible,
}: {
  shipment: ReturnType<typeof resolveSalesOrderFlowDetailShipmentViews>;
  valuesVisible: boolean;
}) {
  return (
    <div
      id="overlay-panel-nfe_envio"
      role="tabpanel"
      data-testid="sales-order-flow-detail-nfe-shipment"
      className="space-y-4"
    >
      <OverlaySection title="Envio">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoField
            label="Primeira data de envio"
            value={formatSalesOrderFlowDetailDate(shipment.firstShippedAt)}
          />
          <InfoField
            label="Última data de envio"
            value={formatSalesOrderFlowDetailDate(shipment.lastShippedAt)}
          />
          <InfoField
            label="Progresso enviado"
            value={formatSalesOrderFlowDetailPercent(shipment.progressShipped)}
          />
          <InfoField
            label="Progresso faturado"
            value={formatSalesOrderFlowDetailPercent(shipment.progressInvoiced)}
          />
        </dl>
      </OverlaySection>

      <OverlaySection
        title="NF-e ativas"
        description={`${shipment.activeNfeCount} NF-e contadas (canceladas excluídas).`}
      >
        {shipment.nfesActive.length === 0 ? (
          <EmptyPanel text="Nenhuma NF-e ativa vinculada oficialmente." />
        ) : (
          <NfeTable rows={shipment.nfesActive} valuesVisible={valuesVisible} />
        )}
      </OverlaySection>

      {shipment.nfesCanceled.length > 0 ? (
        <OverlaySection
          title="NF-e canceladas (não contadas)"
          description={`${shipment.nfesCanceled.length} NF-e canceladas excluídas dos totais.`}
        >
          <NfeTable rows={shipment.nfesCanceled} valuesVisible={valuesVisible} />
        </OverlaySection>
      ) : null}
    </div>
  );
}

function NfeTable({
  rows,
  valuesVisible,
}: {
  rows: ReturnType<typeof resolveSalesOrderFlowDetailShipmentViews>["nfesActive"];
  valuesVisible: boolean;
}) {
  return (
    <OverlayTable>
      <thead>
        <tr>
          <th>NF</th>
          <th>Série</th>
          <th>Status</th>
          <th>Data</th>
          <th>Qtd. vinculada</th>
          <th>Valor vinculado</th>
          <th>Cancelamento</th>
          <th>Link</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((nfe) => (
          <tr
            key={nfe.externalId}
            data-testid={`sales-order-flow-detail-nfe-${nfe.externalId}`}
            className={cn(nfe.isCanceled && "bg-rose-50/60")}
          >
            <td className="font-medium">{nfe.label}</td>
            <td>{nfe.serie?.trim() || "—"}</td>
            <td>{nfe.statusLabel}</td>
            <td>{formatSalesOrderFlowDetailDate(nfe.issuedAt)}</td>
            <td>{formatSalesOrderFlowDetailQuantity(nfe.linkedQuantity)}</td>
            <td>
              {formatSalesOrderFlowDetailMoney(nfe.linkedValue, valuesVisible)}
            </td>
            <td>{nfe.isCanceled ? "Cancelada" : "—"}</td>
            <td>
              <a
                href={nfe.href}
                className="text-primary underline-offset-2 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Abrir
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </OverlayTable>
  );
}

function TimelineTab({
  salesOrderId,
  items,
  timelineVisible,
}: {
  salesOrderId: string;
  items: ReturnType<typeof resolveSalesOrderFlowDetailItems>;
  timelineVisible: boolean;
}) {
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState<
    SalesOrderFlowEventsPayload["items"]
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [itemFilter, setItemFilter] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");

  const itemLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.salesOrderItemId, item.productLabel);
    }
    return map;
  }, [items]);

  useEffect(() => {
    if (!timelineVisible) return;
    const controller = new AbortController();
    setLoading(true);
    setErrorMessage(null);
    setPage(0);
    void fetchSalesOrderFlowEvents(
      salesOrderId,
      {
        page: 0,
        pageSize: 30,
        eventType: (eventTypeFilter || null) as
          | (typeof SALES_ORDER_FLOW_EVENT_TYPES)[number]
          | null,
        salesOrderItemId: itemFilter || null,
      },
      controller.signal
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        setEvents(dedupeSalesOrderFlowDetailEventsByKey(payload.items));
        setHasMore(payload.hasMore);
        setTotal(payload.total);
        setPage(payload.page);
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        setErrorMessage(classifySalesOrderFlowDetailError(cause).message);
        setEvents([]);
        setHasMore(false);
        setTotal(0);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [salesOrderId, timelineVisible, itemFilter, eventTypeFilter]);

  const views = useMemo(
    () =>
      events.map((event) =>
        resolveSalesOrderFlowDetailEventView(event, itemLookup)
      ),
    [events, itemLookup]
  );

  const loadMore = () => {
    if (!hasMore || loadingMore || loading) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    void fetchSalesOrderFlowEvents(salesOrderId, {
      page: nextPage,
      pageSize: 30,
      eventType: (eventTypeFilter || null) as
        | (typeof SALES_ORDER_FLOW_EVENT_TYPES)[number]
        | null,
      salesOrderItemId: itemFilter || null,
    })
      .then((payload) => {
        setEvents((prev) =>
          dedupeSalesOrderFlowDetailEventsByKey([...prev, ...payload.items])
        );
        setHasMore(payload.hasMore);
        setTotal(payload.total);
        setPage(payload.page);
      })
      .catch((cause: unknown) => {
        setErrorMessage(classifySalesOrderFlowDetailError(cause).message);
      })
      .finally(() => setLoadingMore(false));
  };

  if (!timelineVisible) {
    return (
      <div
        id="overlay-panel-timeline"
        role="tabpanel"
        data-testid="sales-order-flow-detail-timeline"
      >
        <EmptyPanel text="Sem permissão para ver a timeline deste pedido." />
      </div>
    );
  }

  return (
    <div
      id="overlay-panel-timeline"
      role="tabpanel"
      data-testid="sales-order-flow-detail-timeline"
      className="space-y-4"
    >
      <OverlaySection
        title="Timeline do ciclo de vida"
        description={`${total} evento(s) · linguagem clara · paginação server-side.`}
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Item
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={itemFilter}
              data-testid="sales-order-flow-timeline-item-filter"
              onChange={(event) => setItemFilter(event.target.value)}
            >
              <option value="">Todos</option>
              {items.map((item) => (
                <option key={item.salesOrderItemId} value={item.salesOrderItemId}>
                  {item.productLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Tipo de evento
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={eventTypeFilter}
              data-testid="sales-order-flow-timeline-type-filter"
              onChange={(event) => setEventTypeFilter(event.target.value)}
            >
              <option value="">Todos</option>
              {SALES_ORDER_FLOW_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {formatSalesOrderFlowEventTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando timeline…</p>
        ) : null}
        {errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        {!loading && !errorMessage && views.length === 0 ? (
          <EmptyPanel text="Nenhum evento de timeline materializado." />
        ) : null}
        {!loading && views.length > 0 ? (
          <OverlayTable>
            <thead>
              <tr>
                <th>Etapa anterior</th>
                <th>Etapa nova</th>
                <th>Data do evento</th>
                <th>Observação</th>
                <th>Origem</th>
                <th>Documento</th>
                <th>Motivo</th>
                <th>Retorno</th>
                <th>Corte</th>
                <th>Cancelamento</th>
              </tr>
            </thead>
            <tbody>
              {views.map((event) => (
                <tr
                  key={event.id}
                  data-testid={`sales-order-flow-detail-event-${event.id}`}
                  className={cn(
                    event.isStageReturn && "bg-amber-50/50",
                    event.isCancellation && "bg-rose-50/50"
                  )}
                >
                  <td>{event.fromStageLabel}</td>
                  <td>
                    <div className="font-medium">{event.toStageLabel}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {event.eventLabel}
                    </div>
                  </td>
                  <td>{formatSalesOrderFlowDetailDate(event.occurredAt)}</td>
                  <td>{formatSalesOrderFlowDetailDate(event.observedAt)}</td>
                  <td>{event.originLabel}</td>
                  <td>{event.relatedDocument?.trim() || "—"}</td>
                  <td>{event.reason?.trim() || "—"}</td>
                  <td>{event.isStageReturn ? "Sim" : "—"}</td>
                  <td>{event.isCut ? "Sim" : "—"}</td>
                  <td>{event.isCancellation ? "Sim" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </OverlayTable>
        ) : null}
        {hasMore ? (
          <button
            type="button"
            className="mt-3 inline-flex rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
            data-testid="sales-order-flow-timeline-load-more"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? "Carregando…" : "Carregar mais"}
          </button>
        ) : null}
      </OverlaySection>
    </div>
  );
}

function InconsistenciesTab({
  detail,
  items,
}: {
  detail: SalesOrderFlowDetailPayload;
  items: ReturnType<typeof resolveSalesOrderFlowDetailItems>;
}) {
  const [itemFilter, setItemFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const allRows = useMemo(
    () => resolveSalesOrderFlowDetailInconsistencyRows(detail, items),
    [detail, items]
  );
  const filtered = useMemo(
    () =>
      filterSalesOrderFlowDetailInconsistencyRows(allRows, {
        salesOrderItemId: itemFilter || null,
        severity: severityFilter || null,
      }),
    [allRows, itemFilter, severityFilter]
  );

  useEffect(() => {
    setPage(0);
  }, [itemFilter, severityFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  if (!detail.inconsistenciesVisible) {
    return (
      <div
        id="overlay-panel-inconsistencias"
        role="tabpanel"
        data-testid="sales-order-flow-detail-inconsistencies"
      >
        <EmptyPanel text="Sem permissão para ver inconsistências deste pedido." />
      </div>
    );
  }

  return (
    <div
      id="overlay-panel-inconsistencias"
      role="tabpanel"
      data-testid="sales-order-flow-detail-inconsistencies"
      className="space-y-4"
    >
      <OverlaySection
        title="Inconsistências detectadas"
        description="Não marcamos resolução sem evidência do motor. Críticas em vermelho claro; alertas em âmbar suave."
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Item
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={itemFilter}
              data-testid="sales-order-flow-inconsistency-item-filter"
              onChange={(event) => setItemFilter(event.target.value)}
            >
              <option value="">Todos</option>
              {items.map((item) => (
                <option key={item.salesOrderItemId} value={item.salesOrderItemId}>
                  {item.productLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Severidade
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={severityFilter}
              data-testid="sales-order-flow-inconsistency-severity-filter"
              onChange={(event) => setSeverityFilter(event.target.value)}
            >
              <option value="">Todas</option>
              {SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {formatSalesOrderFlowInconsistencySeverityLabel(severity)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {filtered.length === 0 ? (
          <EmptyPanel text="Nenhuma inconsistência no filtro atual." />
        ) : (
          <>
            <OverlayTable>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Severidade</th>
                  <th>Explicação</th>
                  <th>Entidade</th>
                  <th>Evidência</th>
                  <th>Área responsável</th>
                  <th>Efeito na conclusão</th>
                  <th>Detecção</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr
                    key={row.key}
                    data-testid={`sales-order-flow-detail-inconsistency-${row.code}`}
                    className={salesOrderFlowInconsistencySeverityClassName(
                      row.severity
                    )}
                  >
                    <td>
                      <div className="font-medium">{row.code}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.label}
                      </div>
                    </td>
                    <td>
                      {formatSalesOrderFlowInconsistencySeverityLabel(
                        row.severity
                      )}
                    </td>
                    <td>{row.explanation?.trim() || row.label}</td>
                    <td>{row.entityLabel}</td>
                    <td>{row.evidence?.trim() || "—"}</td>
                    <td>{row.responsibleArea?.trim() || "—"}</td>
                    <td>{row.conclusionEffect}</td>
                    <td>{formatSalesOrderFlowDetailDate(row.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </OverlayTable>
            {pageCount > 1 ? (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background px-3 py-1.5 disabled:opacity-50"
                  disabled={safePage <= 0}
                  data-testid="sales-order-flow-inconsistency-prev"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  Anterior
                </button>
                <span className="text-muted-foreground">
                  Página {safePage + 1} de {pageCount}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background px-3 py-1.5 disabled:opacity-50"
                  disabled={safePage >= pageCount - 1}
                  data-testid="sales-order-flow-inconsistency-next"
                  onClick={() =>
                    setPage((value) => Math.min(pageCount - 1, value + 1))
                  }
                >
                  Próxima
                </button>
              </div>
            ) : null}
          </>
        )}
      </OverlaySection>
    </div>
  );
}

function OperationalDiagnosticsPanel({
  detail,
}: {
  detail: SalesOrderFlowDetailPayload;
}) {
  const diag = detail.operationalDiagnostics;
  if (!diag) {
    return (
      <OverlaySection title="Por que está nesta coluna?">
        <EmptyPanel text="Diagnóstico operacional indisponível para este pedido." />
      </OverlaySection>
    );
  }

  return (
    <OverlaySection title={diag.title}>
      <div
        className="space-y-4"
        data-testid="sales-order-flow-operational-diagnostics"
      >
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
          <FlatField
            label="Obrigação ainda pendente"
            value={diag.pendingObligation ? "Sim" : "Não"}
          />
          <FlatField
            label="Item gargalo"
            value={diag.bottleneckItemLabel}
          />
          <FlatField label="Motivo do gargalo" value={diag.bottleneckReason} />
          <FlatField label="Próxima ação" value={diag.nextAction} />
          <FlatField
            label="Área responsável"
            value={formatResponsibleAreaLabel(diag.responsibleArea)}
          />
          <FlatField
            label="Último cálculo"
            value={formatSalesOrderFlowDetailDate(diag.computedAt)}
          />
          <FlatField
            label="Versão do cálculo"
            value={
              diag.computationVersion
                ? diag.snapshotDivergent
                  ? `${diag.computationVersion} (esperada ${diag.expectedComputationVersion})`
                  : diag.computationVersion
                : diag.expectedComputationVersion
            }
            className="sm:col-span-2"
          />
          <FlatField
            label="Por que esta coluna"
            value={diag.stageReason}
            className="sm:col-span-2 xl:col-span-3"
          />
        </dl>

        {diag.evidencesFound.length > 0 ? (
          <div data-testid="sales-order-flow-diagnostics-found">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Evidências encontradas
            </p>
            <ul className="space-y-2">
              {diag.evidencesFound.map((line, index) => (
                <li
                  key={`found-${index}-${line.label}`}
                  className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 px-3 py-2 text-sm text-emerald-950"
                >
                  <p className="font-medium">{line.label}</p>
                  {line.detail ? (
                    <p className="mt-0.5 text-emerald-900/80">{line.detail}</p>
                  ) : null}
                  {line.sourceLabel ? (
                    <p className="mt-1 text-[11px] text-emerald-900/70">
                      Origem do vínculo: {line.sourceLabel}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyPanel text="Nenhuma evidência operacional avançada encontrada." />
        )}

        {diag.evidencesMissing.length > 0 ? (
          <div data-testid="sales-order-flow-diagnostics-missing">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Evidências ausentes
            </p>
            <ul className="space-y-2">
              {diag.evidencesMissing.map((line, index) => (
                <li
                  key={`missing-${index}-${line.label}`}
                  className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-sm text-amber-950"
                >
                  <p className="font-medium">{line.label}</p>
                  {line.detail ? (
                    <p className="mt-0.5 text-amber-900/80">{line.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {diag.items.length > 0 ? (
          <div data-testid="sales-order-flow-diagnostics-items">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cobertura por item
            </p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 font-semibold">Obrigação</th>
                    <th className="px-3 py-2 font-semibold">Saldo</th>
                    <th className="px-3 py-2 font-semibold">OP</th>
                    <th className="px-3 py-2 font-semibold">DS</th>
                    <th className="px-3 py-2 font-semibold">NF</th>
                    <th className="px-3 py-2 font-semibold">Envio</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.items.map((item) => (
                    <tr
                      key={item.salesOrderItemId}
                      className="border-t border-border"
                      data-testid={`sales-order-flow-diagnostics-item-${item.sequence ?? item.salesOrderItemId}`}
                    >
                      <td className="px-3 py-2">
                        {[item.sequence ? `Item ${item.sequence}` : null, item.productLabel]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {formatSalesOrderFlowDetailQuantity(item.activeObligation)}
                      </td>
                      <td className="px-3 py-2">
                        {formatSalesOrderFlowDetailQuantity(
                          item.remainingFulfillment
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {formatSalesOrderFlowDetailQuantity(
                          item.productionOrderQuantity
                        )}{" "}
                        <span className="text-[11px] text-muted-foreground">
                          ({item.productionCoverage})
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {formatSalesOrderFlowDetailQuantity(
                          item.documentedQuantity
                        )}{" "}
                        <span className="text-[11px] text-muted-foreground">
                          ({item.documentedCoverage})
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {formatSalesOrderFlowDetailQuantity(
                          item.invoicedQuantity
                        )}{" "}
                        <span className="text-[11px] text-muted-foreground">
                          ({item.invoicedCoverage})
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {formatSalesOrderFlowDetailQuantity(item.shippedQuantity)}{" "}
                        <span className="text-[11px] text-muted-foreground">
                          ({item.shippedCoverage})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {diag.warnings.length > 0 ? (
          <div data-testid="sales-order-flow-diagnostics-warnings">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Alertas
            </p>
            <ul className="space-y-1.5">
              {diag.warnings.map((warning, index) => (
                <li
                  key={`warn-${index}`}
                  className="rounded-lg border border-amber-200/70 bg-amber-50/40 px-3 py-2 text-sm text-amber-950"
                >
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </OverlaySection>
  );
}

const HEADER_ACTION_BTN =
  "inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50";

const SALES_ORDER_FLOW_BASE_BADGE_LABELS: Record<string, string> = {
  OVERDUE: "Atrasado",
  INCONSISTENT: "Inconsistente",
  PARTIAL: "Parcial — saldo pendente",
  CUT: "Atendido com corte",
  CANCELED: "Cancelado",
  MIXED_STAGES: "Etapas mistas",
  COMPLETED: "Concluído",
  OUT_OF_ACTIVE_COLUMNS: "Fora das colunas ativas",
};

function formatSalesOrderFlowBadgeLabel(badge: string): string {
  return (
    SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS[
      badge as keyof typeof SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS
    ] ??
    SALES_ORDER_FLOW_BASE_BADGE_LABELS[badge] ??
    badge
  );
}

function formatResponsibleAreaLabel(
  area: string | null | undefined
): string {
  const raw = area?.trim();
  if (!raw) return "—";
  const match = SALES_ORDER_FLOW_MANAGEMENT_AREA_OPTIONS.find(
    (opt) => opt.value === raw
  );
  return match?.label ?? raw;
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border bg-background/70 p-6 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

/** Campo flat no estilo Pedidos de Venda (sem card por valor). */
function FlatField({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-[#64748b]">
        {label}
      </dt>
      <dd className="mt-0.5 text-[12px] font-medium leading-snug text-[#0f172a]">
        {value?.trim() || "—"}
      </dd>
    </div>
  );
}

/** Cards densos — ainda usados nas abas operacionais (NF-e / envio). */
function InfoField({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card px-3 py-2.5", className)}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">
        {value?.trim() || "—"}
      </dd>
    </div>
  );
}

function DrawerState({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/70 p-10 text-sm text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </div>
  );
}
