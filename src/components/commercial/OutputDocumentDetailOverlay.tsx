import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
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
  fetchOutputDocumentDetail,
  type OutputDocumentDetailPayload,
} from "@/src/lib/outputDocumentsClient";
import type { OutputDocumentDetailItem } from "@/src/lib/output-documents/outputDocumentsDetailTypes";
import {
  classifyOutputDocumentsDetailError,
  formatOutputDocumentCancellation,
  formatOutputDocumentDate,
  formatOutputDocumentDateTime,
  formatOutputDocumentFinancialStatusLabel,
  formatOutputDocumentItemCode,
  formatOutputDocumentItemDescription,
  formatOutputDocumentItemLinkStatusLabel,
  formatOutputDocumentItemLocalProduct,
  formatOutputDocumentItemOrder,
  formatOutputDocumentItemOrderItem,
  formatOutputDocumentLabel,
  formatOutputDocumentMoney,
  formatOutputDocumentNumber,
  formatOutputDocumentPrimaryNfe,
  formatOutputDocumentStatusLabel,
  outputDocumentFinancialStatusTone,
  outputDocumentItemLinkStatusTone,
  outputDocumentStatusTone,
} from "@/src/lib/outputDocumentsUi";

type Props = {
  outputDocumentId: string | null;
  onClose: () => void;
};

type OutputDocumentDetailTab = "geral" | "itens";

export function OutputDocumentDetailOverlay({
  outputDocumentId,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<OutputDocumentDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<
    "not_found" | "access_denied" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OutputDocumentDetailTab>("geral");

  useEffect(() => {
    if (!outputDocumentId) {
      setDetail(null);
      setErrorKind(null);
      setErrorMessage(null);
      setActiveTab("geral");
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);
    setActiveTab("geral");
    void fetchOutputDocumentDetail(outputDocumentId, { signal: controller.signal })
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
  }, [outputDocumentId]);

  const titleId = "output-document-detail-title";
  const documentLabel = detail
    ? formatOutputDocumentNumber({
        documentNumber: detail.document.documentNumber,
        externalId: detail.document.externalId,
      })
    : null;

  return (
    <Overlay
      open={outputDocumentId != null}
      onClose={onClose}
      size="full"
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
      <OverlayTabs
        tabs={[
          { id: "geral", label: "Geral" },
          {
            id: "itens",
            label: "Itens",
            count: detail?.items.length,
          },
        ]}
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
        ) : detail ? (
          <OutputDocumentDetailContent detail={detail} activeTab={activeTab} />
        ) : null}
      </OverlayBody>
    </Overlay>
  );
}

export function OutputDocumentDetailContent({
  detail,
  activeTab = "geral",
}: {
  detail: OutputDocumentDetailPayload;
  activeTab?: OutputDocumentDetailTab;
}) {
  if (activeTab === "itens") {
    return (
      <div
        id="overlay-panel-itens"
        role="tabpanel"
        className="space-y-4"
        data-testid="output-document-detail-items-panel"
      >
        <OverlaySection
          title="Itens do documento"
          description={`${detail.resolution.itemCount} item(ns) · ${detail.resolution.itemsUnresolved} não resolvido(s)`}
        >
          <OutputDocumentItemsTable items={detail.items} />
        </OverlaySection>
      </div>
    );
  }

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
          <div className="flex flex-wrap items-center gap-1.5">
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
                : "Sem permissão ou sem dados"
            }
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

function OutputDocumentItemsTable({
  items,
}: {
  items: ReadonlyArray<OutputDocumentDetailItem>;
}) {
  if (items.length === 0) {
    return (
      <p
        className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground"
        data-testid="output-document-detail-items-empty"
      >
        Este Documento de Saída não possui itens no stage.
      </p>
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
            "Código",
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
              {formatOutputDocumentItemCode(item)}
            </OverlayTable.Cell>
            <OverlayTable.Cell>
              <div className="max-w-[16rem]">{formatOutputDocumentItemDescription(item)}</div>
            </OverlayTable.Cell>
            <OverlayTable.Cell mono className="tabular-nums">
              {formatQuantity(item.quantity)}
            </OverlayTable.Cell>
            <OverlayTable.Cell>—</OverlayTable.Cell>
            <OverlayTable.Cell mono className="tabular-nums">
              {formatOutputDocumentMoney(item.unitValue)}
            </OverlayTable.Cell>
            <OverlayTable.Cell mono className="tabular-nums">
              {formatOutputDocumentMoney(item.totalValue)}
            </OverlayTable.Cell>
            <OverlayTable.Cell>{formatOutputDocumentItemOrder(item)}</OverlayTable.Cell>
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
