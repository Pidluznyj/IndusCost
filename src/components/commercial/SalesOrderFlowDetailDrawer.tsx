import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  Overlay,
  OverlayBadge,
  OverlayBody,
  OverlayHeader,
  OverlaySection,
  OverlayTable,
  OverlayTabs,
} from "@/src/components/ui/overlay";
import {
  fetchSalesOrderFlowDetail,
  type SalesOrderFlowDetailPayload,
} from "@/src/lib/salesOrderFlowClient";
import {
  classifySalesOrderFlowDetailError,
  formatSalesOrderFlowDetailDate,
  formatSalesOrderFlowDetailDays,
  formatSalesOrderFlowDetailMoney,
  formatSalesOrderFlowDetailPercent,
  formatSalesOrderFlowDetailQuantity,
  formatSalesOrderFlowInconsistencyLabel,
  formatSalesOrderFlowPriorityLabel,
  formatSalesOrderFlowStageLabel,
  resolveSalesOrderFlowDetailDaysInStage,
  resolveSalesOrderFlowDetailItems,
  type SalesOrderFlowDetailTab,
} from "@/src/lib/salesOrderFlowDetailUi";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  salesOrderId: string | null;
  orderCode?: string | null;
  onClose: () => void;
};

/**
 * Drawer largo do Fluxo de Pedidos (OP-69): Resumo + Itens.
 * Reutiliza o Overlay canônico; não altera a URL nem desmonta o Kanban.
 */
export function SalesOrderFlowDetailDrawer({
  open,
  salesOrderId,
  orderCode,
  onClose,
}: Props) {
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

  useEffect(() => {
    if (!open || !salesOrderId) {
      setDetail(null);
      setErrorKind(null);
      setErrorMessage(null);
      setActiveTab("resumo");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);
    setActiveTab("resumo");
    void fetchSalesOrderFlowDetail(salesOrderId, controller.signal)
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
        const classified = classifySalesOrderFlowDetailError(cause);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, salesOrderId, retryToken]);

  const items = useMemo(
    () => (detail ? resolveSalesOrderFlowDetailItems(detail) : []),
    [detail]
  );
  const titleId = "sales-order-flow-detail-title";
  const displayCode =
    detail?.order.orderCode ?? orderCode?.trim() ?? "Pedido";

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
          detail ? (
            <div className="hidden flex-wrap items-center gap-2 sm:flex">
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
          ) : null
        }
        onClose={onClose}
        closeLabel="Fechar detalhe do fluxo"
        density="default"
      />
      <OverlayTabs
        tabs={[
          { id: "resumo", label: "Resumo" },
          { id: "itens", label: "Itens", count: items.length },
        ]}
        active={activeTab}
        onChange={setActiveTab}
        variant="pill"
        testId="sales-order-flow-detail-tabs"
        ariaLabel="Seções do detalhe do Fluxo de Pedidos"
      />
      <OverlayBody className="bg-[color:var(--color-overlay-surface-muted)] px-4 py-4">
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

        {!loading && !errorMessage && detail ? (
          <SalesOrderFlowDetailContent
            detail={detail}
            items={items}
            activeTab={activeTab}
          />
        ) : null}
      </OverlayBody>
    </Overlay>
  );
}

export function SalesOrderFlowDetailContent({
  detail,
  items,
  activeTab,
}: {
  detail: SalesOrderFlowDetailPayload;
  items: ReturnType<typeof resolveSalesOrderFlowDetailItems>;
  activeTab: SalesOrderFlowDetailTab;
}) {
  if (activeTab === "itens") {
    return <ItemsTab detail={detail} items={items} />;
  }
  return <SummaryTab detail={detail} />;
}

function SummaryTab({ detail }: { detail: SalesOrderFlowDetailPayload }) {
  const daysInStage = resolveSalesOrderFlowDetailDaysInStage(detail);
  const valuesVisible = detail.valuesVisible;
  const financial = detail.financialSituation;

  return (
    <div
      className="space-y-4"
      id="overlay-panel-resumo"
      role="tabpanel"
      data-testid="sales-order-flow-detail-summary"
    >
      <OverlaySection title="Situação operacional">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <InfoField
            label="Etapa"
            value={formatSalesOrderFlowStageLabel(detail.columnExplanation.stage)}
          />
          <InfoField
            label="Próxima ação"
            value={detail.nextAction ?? detail.columnExplanation.nextAction}
          />
          <InfoField
            label="Área responsável"
            value={
              detail.responsibleArea ?? detail.columnExplanation.responsibleArea
            }
          />
          <InfoField
            label="Explicação"
            value={detail.columnExplanation.reason}
            className="sm:col-span-2 xl:col-span-3"
          />
          <InfoField
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
        </dl>
      </OverlaySection>

      <OverlaySection title="Identificação">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <InfoField label="Cliente" value={detail.order.customerName} />
          <InfoField label="Vendedor" value={detail.order.sellerName} />
          <InfoField label="Empresa" value={detail.order.companyIssuer} />
          <InfoField
            label="Emissão"
            value={formatSalesOrderFlowDetailDate(detail.order.issueDate)}
          />
          <InfoField
            label="Entrega prometida"
            value={formatSalesOrderFlowDetailDate(
              detail.shipmentDates?.promisedDeliveryAt ??
                detail.order.expectedDeliveryDate
            )}
          />
          <InfoField
            label="Dias na etapa"
            value={formatSalesOrderFlowDetailDays(daysInStage)}
          />
        </dl>
      </OverlaySection>

      <OverlaySection title="Valores">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <InfoField
            label="Valor do pedido"
            value={formatSalesOrderFlowDetailMoney(
              financial?.orderValue,
              valuesVisible
            )}
          />
          <InfoField
            label="Saldo ativo"
            value={formatSalesOrderFlowDetailMoney(
              financial?.activeResidualValue,
              valuesVisible
            )}
          />
          <InfoField
            label="Valor cortado"
            value={formatSalesOrderFlowDetailMoney(
              financial?.cutValue,
              valuesVisible
            )}
          />
        </dl>
      </OverlaySection>

      <OverlaySection title="Progressos">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <InfoField
            label="OP"
            value={formatSalesOrderFlowDetailPercent(
              detail.progress?.productionOrder
            )}
          />
          <InfoField
            label="Produzido"
            value={formatSalesOrderFlowDetailPercent(detail.progress?.produced)}
          />
          <InfoField
            label="Documentado"
            value={formatSalesOrderFlowDetailPercent(
              detail.progress?.documented
            )}
          />
          <InfoField
            label="Faturado"
            value={formatSalesOrderFlowDetailPercent(detail.progress?.invoiced)}
          />
          <InfoField
            label="Enviado"
            value={formatSalesOrderFlowDetailPercent(detail.progress?.shipped)}
          />
        </dl>
      </OverlaySection>

      <OverlaySection title="Gestão">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <InfoField
            label="Prioridade"
            value={formatSalesOrderFlowPriorityLabel(
              detail.management?.priority
            )}
          />
          <InfoField
            label="Bloqueio"
            value={
              detail.management?.isBlocked
                ? detail.management.blockReason?.trim() || "Bloqueado"
                : "Não bloqueado"
            }
          />
          <InfoField
            label="Inconsistências"
            value={
              detail.inconsistenciesVisible
                ? detail.inconsistencies.length > 0
                  ? `${detail.inconsistencies.length}`
                  : "Nenhuma"
                : "Oculto"
            }
          />
        </dl>
        {detail.inconsistenciesVisible && detail.inconsistencies.length > 0 ? (
          <ul className="mt-3 space-y-1.5 text-sm text-amber-950">
            {detail.inconsistencies.map((item) => (
              <li
                key={`${item.code}-${item.detail ?? ""}`}
                className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2"
              >
                <strong>
                  {formatSalesOrderFlowInconsistencyLabel(item.code)}
                </strong>
                {item.detail ? ` — ${item.detail}` : null}
              </li>
            ))}
          </ul>
        ) : null}
      </OverlaySection>
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
      >
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-background/70 p-6 text-center text-sm text-muted-foreground">
            Nenhum item materializado no snapshot do fluxo.
          </p>
        ) : (
          <OverlayTable>
            <thead>
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
                      <div className="mt-1 text-[11px] text-amber-800">
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
