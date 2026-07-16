import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
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
  fetchProductionOrderDetail,
  type ProductionOrderDetailResponse,
} from "@/src/lib/productionOrdersClient";
import type { ProductionOrderDetailSalesLink } from "@/src/lib/productionOrdersDetail";
import {
  classifyProductionOrdersListError,
  formatProductionOrderDateTime,
  formatProductionOrderQuantity,
  productionOrderStatusOverlayTone,
} from "@/src/lib/productionOrdersUi";

type Props = {
  productionOrderId: string | null;
  onClose: () => void;
};

type ProductionOrderDetailTab = "geral" | "auditoria";

export function ProductionOrderQuickDetailOverlay({
  productionOrderId,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<ProductionOrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProductionOrderDetailTab>("geral");

  useEffect(() => {
    if (!productionOrderId) {
      setDetail(null);
      setError(null);
      setCopyFeedback(null);
      setActiveTab("geral");
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setError(null);
    setActiveTab("geral");
    void fetchProductionOrderDetail(productionOrderId, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setDetail(payload);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(classifyProductionOrdersListError(cause).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productionOrderId]);

  const technicalJson = useMemo(
    () => (detail ? stringifyProductionOrderTechnicalEvidence(detail) : ""),
    [detail]
  );

  const copyTechnicalJson = async () => {
    if (!detail) return;
    try {
      await copyProductionOrderTechnicalEvidence(detail, navigator.clipboard);
      setCopyFeedback("JSON copiado.");
    } catch {
      setCopyFeedback("Não foi possível copiar o JSON.");
    }
  };

  const titleId = "production-order-audit-title";
  return (
    <Overlay
      open={productionOrderId != null}
      onClose={onClose}
      size="full"
      ariaLabelledBy={titleId}
      ariaDescribedBy="production-order-audit-description"
      testId="production-order-audit-drawer"
      className="h-[calc(100vh-2rem)] !max-w-[1400px] sm:h-[92vh]"
    >
      <OverlayHeader
        titleId={titleId}
        eyebrow={
          detail
            ? `Operações · Ordens de Produção · Nomus #${detail.identification.externalId}`
            : "Operações · Ordem de Produção"
        }
        title={
          detail
            ? `Detalhe da Ordem — ${detail.identification.name ?? `#${detail.identification.externalId}`}`
            : "Detalhe da Ordem de Produção"
        }
        subtitle={
          <span id="production-order-audit-description">
            {detail
              ? `${detail.company.companyName ?? "Empresa não informada"} · Última sincronização: ${formatProductionOrderDateTime(detail.dates.syncedAt)}`
              : "Consulta local somente leitura"}
          </span>
        }
        actions={
          detail ? (
            <div className="hidden items-center gap-2 sm:flex">
              <OverlayBadge
                tone={productionOrderStatusOverlayTone(detail.identification.status)}
                emphasized
              >
                {detail.identification.status ?? "Sem status"}
              </OverlayBadge>
              {detail.identification.tipo ? (
                <OverlayBadge tone="slate">{detail.identification.tipo}</OverlayBadge>
              ) : null}
            </div>
          ) : null
        }
        onClose={onClose}
        closeLabel="Fechar auditoria"
        density="default"
      />
      <OverlayTabs
        tabs={[
          { id: "geral", label: "Geral" },
          {
            id: "auditoria",
            label: "Auditoria",
            count: detail == null ? undefined : detail.auditSummary.pendingLinkCount + detail.auditSummary.removedLinkCount,
          },
        ]}
        active={activeTab}
        onChange={setActiveTab}
        variant="pill"
        testId="production-order-detail-tabs"
        ariaLabel="Seções do detalhe da Ordem de Produção"
      />
      <OverlayBody className="bg-[color:var(--color-overlay-surface-muted)] px-4 py-4">
        {loading ? (
          <DrawerState testId="production-order-detail-loading">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando detalhe…
          </DrawerState>
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            data-testid="production-order-detail-error"
          >
            {error}
          </div>
        ) : detail ? (
          <ProductionOrderAuditContent
            detail={detail}
            technicalJson={technicalJson}
            copyFeedback={copyFeedback}
            onCopy={() => void copyTechnicalJson()}
            activeTab={activeTab}
          />
        ) : null}
      </OverlayBody>
    </Overlay>
  );
}

export function buildProductionOrderTechnicalEvidence(
  detail: ProductionOrderDetailResponse
): {
  productionOrder: unknown;
  salesLinks: Array<{
    id: string;
    externalSalesOrderId: number;
    externalSalesOrderItemId: number;
    rawJson: unknown | null;
  }>;
} {
  return {
    productionOrder: detail.rawJson,
    salesLinks: detail.salesLinks.map((link) => ({
      id: link.id,
      externalSalesOrderId: link.externalSalesOrderId,
      externalSalesOrderItemId: link.externalSalesOrderItemId,
      rawJson: link.rawJson,
    })),
  };
}

export function stringifyProductionOrderTechnicalEvidence(
  detail: ProductionOrderDetailResponse
): string {
  return JSON.stringify(buildProductionOrderTechnicalEvidence(detail), null, 2);
}

export async function copyProductionOrderTechnicalEvidence(
  detail: ProductionOrderDetailResponse,
  clipboard: Pick<Clipboard, "writeText">
): Promise<string> {
  const text = stringifyProductionOrderTechnicalEvidence(detail);
  await clipboard.writeText(text);
  return text;
}

export function ProductionOrderAuditContent({
  detail,
  technicalJson,
  copyFeedback,
  onCopy,
  activeTab = "geral",
}: {
  detail: ProductionOrderDetailResponse;
  technicalJson: string;
  copyFeedback: string | null;
  onCopy: () => void;
  activeTab?: ProductionOrderDetailTab;
}) {
  if (activeTab === "auditoria") {
    return (
      <div id="overlay-panel-auditoria" role="tabpanel" className="space-y-4" data-testid="production-order-detail-audit-panel">
        <OverlaySection title="Auditoria interna">
          <AuditFieldGrid>
            <AuditField label="Vínculos atuais" value={String(detail.auditSummary.currentLinkCount)} />
            <AuditField label="Vínculos históricos" value={String(detail.auditSummary.removedLinkCount)} />
            <AuditField label="Vínculos resolvidos" value={String(detail.auditSummary.resolvedLinkCount)} />
            <AuditField label="Vínculos pendentes" value={String(detail.auditSummary.pendingLinkCount)} />
            <AuditField label="Payload hash" value={detail.payloadHash} mono wide />
            <DateField label="Primeiro registro" value={detail.dates.firstSeenAt} />
            <DateField label="Último registro" value={detail.dates.lastSeenAt} />
            <DateField label="Última alteração" value={detail.dates.lastChangedAt} />
            <DateField label="Sincronização" value={detail.dates.syncedAt} />
          </AuditFieldGrid>
        </OverlaySection>
        <OverlaySection title="Dados técnicos do Nomus">
          <details className="rounded-lg border border-border bg-card" data-testid="production-order-raw-json">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Payload original do Nomus</summary>
            <div className="space-y-3 border-t border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Evidência técnica somente leitura. O conteúdo é exibido como texto e não executa HTML.</p>
                <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted" data-testid="production-order-copy-json">
                  {copyFeedback === "JSON copiado." ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                  Copiar JSON
                </button>
              </div>
              <p className="sr-only" aria-live="polite">{copyFeedback}</p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-100">{technicalJson}</pre>
            </div>
          </details>
        </OverlaySection>
      </div>
    );
  }

  return (
    <div id="overlay-panel-geral" role="tabpanel" className="space-y-4" data-testid="production-order-detail-content">
      <OverlaySection title="Detalhe da Ordem">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Ordem de Produção Nomus · {detail.company.companyName ?? "Empresa não informada"}</p>
            <h2 className="mt-0.5 text-lg font-bold text-foreground">{detail.identification.name ?? `OP #${detail.identification.externalId}`}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <OverlayBadge
              tone={productionOrderStatusOverlayTone(detail.identification.status)}
              emphasized
            >
              {detail.identification.status ?? "Sem status"}
            </OverlayBadge>
            {detail.identification.tipo ? <OverlayBadge tone="slate">{detail.identification.tipo}</OverlayBadge> : null}
          </div>
        </div>
        <AuditFieldGrid className="mt-4">
          <AuditField label="Ordem" value={detail.identification.name} />
          <AuditField label="ID Nomus" value={String(detail.identification.externalId)} mono />
          <AuditField label="Tipo" value={detail.identification.tipo} />
          <AuditField label="Prioridade" value={detail.identification.priority} />
          <AuditField label="Empresa" value={detail.company.companyName} />
          <AuditField label="Setor de estoque" value={detail.product.stockSector} />
        </AuditFieldGrid>
      </OverlaySection>

      <OverlaySection title="Resumo executivo">
        <OverlayKpiCardGrid columns={5}>
          <OverlayKpiCard label="Quantidade" value={formatProductionOrderQuantity(detail.product.quantity, detail.product.unit)} tone="info" size="sm" />
          <OverlayKpiCard label="Status" value={detail.identification.status ?? "—"} tone={detail.identification.status?.toLowerCase().includes("cancel") ? "negative" : "positive"} size="sm" />
          <OverlayKpiCard label="Prioridade" value={detail.identification.priority ?? "—"} size="sm" />
          <OverlayKpiCard label="Pedidos vinculados" value={String(detail.auditSummary.currentLinkCount)} tone={detail.auditSummary.pendingLinkCount > 0 ? "warning" : "neutral"} size="sm" />
          <OverlayKpiCard label="Entrega planejada" value={formatProductionOrderDateTime(detail.dates.deliveryAt)} size="sm" />
        </OverlayKpiCardGrid>
      </OverlaySection>

      <OverlaySection title="Produto">
        <AuditFieldGrid>
          <AuditField label="ID Nomus" value={displayNumber(detail.product.externalProductId)} mono />
          <AuditField label="Código" value={detail.product.productCode} mono />
          <AuditField label="Descrição" value={detail.product.productDescription} wide />
          <AuditField
            label="Informação adicional"
            value={detail.product.productAdditionalInfo}
            wide
          />
          <AuditField
            label="Configuração"
            value={displayNumber(detail.product.productConfigId)}
            mono
          />
          <AuditField label="Código da configuração" value={detail.product.productConfigCode} mono />
        </AuditFieldGrid>
      </OverlaySection>

      <OverlaySection title="Datas operacionais">
        <AuditFieldGrid>
          <DateField label="Abertura" value={detail.dates.openedAt} />
          <DateField label="Liberação" value={detail.dates.releasedAt} />
          <DateField label="Planejada" value={detail.dates.plannedAt} />
          <DateField label="Entrega" value={detail.dates.deliveryAt} />
          <DateField label="Encerramento" value={detail.dates.closedAt} />
          <DateField label="Última alteração no Nomus" value={detail.dates.nomusUpdatedAt} />
          <DateField label="Sincronização mais recente" value={detail.dates.syncedAt} />
        </AuditFieldGrid>
      </OverlaySection>

      <OverlaySection title="Pedidos de Venda vinculados">
        <SalesLinksTable links={detail.salesLinks} />
      </OverlaySection>

    </div>
  );
}

function SalesLinksTable({ links }: { links: ProductionOrderDetailSalesLink[] }) {
  if (links.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
        Esta Ordem de Produção não possui vínculo de Pedido de Venda registrado.
      </p>
    );
  }
  return (
    <OverlayTable className="min-w-[1280px]" data-testid="production-order-sales-links">
      <OverlayTable.Head>
        <OverlayTable.Row>
          {[
            "Situação",
            "Pedido de Venda",
            "Item",
            "Cliente",
            "Qtd. vinculada",
            "ID externo pedido",
            "ID externo item",
            "Primeiro registro",
            "Último registro",
            "Remoção",
          ].map((label) => (
            <OverlayTable.HeadCell key={label}>{label}</OverlayTable.HeadCell>
          ))}
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {links.map((link) => (
          <OverlayTable.Row key={link.id} data-testid={`production-order-sales-link-${link.id}`}>
            <OverlayTable.Cell>
              <LinkStateBadge link={link} />
            </OverlayTable.Cell>
            <OverlayTable.Cell>
              {link.salesOrderId ? (
                <Link
                  to={`/sales-orders/${link.salesOrderId}`}
                  className="font-semibold text-primary hover:underline"
                  data-testid={`production-order-open-sales-order-${link.salesOrderId}`}
                >
                  {link.orderCode ?? `Pedido #${link.externalSalesOrderId}`}
                </Link>
              ) : (
                link.orderCode ?? "—"
              )}
            </OverlayTable.Cell>
            <OverlayTable.Cell>
              <div>{link.itemNumber ?? link.localItem?.nomusItemSequence ?? "—"}</div>
              {link.localItem ? (
                <div className="mt-1 max-w-56 text-xs text-muted-foreground">
                  {link.localItem.skuSnapshot ?? "SKU não informado"} ·{" "}
                  {link.localItem.productNameSnapshot ?? "Produto não informado"}
                </div>
              ) : null}
            </OverlayTable.Cell>
            <OverlayTable.Cell>{link.customerName ?? "—"}</OverlayTable.Cell>
            <OverlayTable.Cell mono>
              {formatProductionOrderQuantity(link.linkedQuantity, link.localItem?.unit)}
            </OverlayTable.Cell>
            <OverlayTable.Cell mono>{link.externalSalesOrderId}</OverlayTable.Cell>
            <OverlayTable.Cell mono>{link.externalSalesOrderItemId}</OverlayTable.Cell>
            <OverlayTable.Cell>{formatProductionOrderDateTime(link.firstSeenAt)}</OverlayTable.Cell>
            <OverlayTable.Cell>{formatProductionOrderDateTime(link.lastSeenAt)}</OverlayTable.Cell>
            <OverlayTable.Cell>{formatProductionOrderDateTime(link.removedAt)}</OverlayTable.Cell>
          </OverlayTable.Row>
        ))}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

function LinkStateBadge({ link }: { link: ProductionOrderDetailSalesLink }) {
  if (link.linkState === "removed") {
    return <OverlayBadge tone="rose">Removido</OverlayBadge>;
  }
  if (link.linkState === "current_pending") {
    return <OverlayBadge tone="amber">Pendente de resolução local</OverlayBadge>;
  }
  return <OverlayBadge tone="emerald">Atual</OverlayBadge>;
}

function AuditFieldGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${className ?? ""}`}>{children}</dl>;
}

function AuditField({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1 break-words text-sm font-medium text-foreground ${mono ? "font-mono text-xs" : ""}`}>
        {value == null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function DateField({ label, value }: { label: string; value: string | null }) {
  return <AuditField label={label} value={formatProductionOrderDateTime(value)} />;
}

function DrawerState({
  children,
  testId,
}: {
  children: React.ReactNode;
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

function displayNumber(value: number | null): string | null {
  return value == null ? null : String(value);
}
