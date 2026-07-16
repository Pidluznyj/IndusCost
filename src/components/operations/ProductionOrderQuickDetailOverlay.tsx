import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Overlay,
  OverlayBadge,
  OverlayBody,
  OverlayHeader,
  OverlaySection,
  OverlayTable,
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

export function ProductionOrderQuickDetailOverlay({
  productionOrderId,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<ProductionOrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!productionOrderId) {
      setDetail(null);
      setError(null);
      setCopyFeedback(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setError(null);
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
      size="xl"
      ariaLabelledBy={titleId}
      ariaDescribedBy="production-order-audit-description"
      testId="production-order-audit-drawer"
      className="ml-auto h-full max-h-[calc(100vh-2rem)]"
    >
      <OverlayHeader
        titleId={titleId}
        eyebrow={
          detail
            ? `Operações · Ordem de Produção · Nomus #${detail.identification.externalId}`
            : "Operações · Ordem de Produção"
        }
        title={detail?.identification.name ?? "Auditoria da Ordem de Produção"}
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
        density="prominent"
      />
      <OverlayBody>
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
}: {
  detail: ProductionOrderDetailResponse;
  technicalJson: string;
  copyFeedback: string | null;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-5" data-testid="production-order-detail-content">
      <dl className="grid grid-cols-2 gap-3 sm:hidden">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Situação
          </dt>
          <dd className="mt-1">
            <OverlayBadge
              tone={productionOrderStatusOverlayTone(detail.identification.status)}
              emphasized
            >
              {detail.identification.status ?? "Sem status"}
            </OverlayBadge>
          </dd>
        </div>
        <DateField label="Abertura" value={detail.dates.openedAt} />
      </dl>

      <OverlaySection title="Resumo">
        <AuditFieldGrid>
          <AuditField label="Ordem" value={detail.identification.name} />
          <AuditField label="Tipo" value={detail.identification.tipo} />
          <AuditField label="Prioridade" value={detail.identification.priority} />
          <AuditField label="Empresa" value={detail.company.companyName} />
          <AuditField
            label="Quantidade"
            value={formatProductionOrderQuantity(detail.product.quantity, null)}
          />
          <AuditField label="Unidade" value={detail.product.unit} />
          <AuditField label="Setor de estoque" value={detail.product.stockSector} />
        </AuditFieldGrid>
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

      <OverlaySection title="Datas">
        <AuditFieldGrid>
          <DateField label="Abertura" value={detail.dates.openedAt} />
          <DateField label="Liberação" value={detail.dates.releasedAt} />
          <DateField label="Planejada" value={detail.dates.plannedAt} />
          <DateField label="Entrega" value={detail.dates.deliveryAt} />
          <DateField label="Encerramento" value={detail.dates.closedAt} />
          <DateField label="Última alteração no Nomus" value={detail.dates.nomusUpdatedAt} />
          <DateField label="Primeira visualização pelo IndusCost" value={detail.dates.firstSeenAt} />
          <DateField label="Última visualização" value={detail.dates.lastSeenAt} />
          <DateField label="Última alteração de payload" value={detail.dates.lastChangedAt} />
          <DateField label="Sincronização mais recente" value={detail.dates.syncedAt} />
        </AuditFieldGrid>
      </OverlaySection>

      <OverlaySection title="Pedidos de Venda vinculados">
        <SalesLinksTable links={detail.salesLinks} />
      </OverlaySection>

      <OverlaySection title="Auditoria interna">
        <AuditFieldGrid>
          <AuditField label="Vínculos atuais" value={String(detail.auditSummary.currentLinkCount)} />
          <AuditField
            label="Vínculos históricos"
            value={String(detail.auditSummary.removedLinkCount)}
          />
          <AuditField
            label="Vínculos resolvidos"
            value={String(detail.auditSummary.resolvedLinkCount)}
          />
          <AuditField
            label="Vínculos pendentes"
            value={String(detail.auditSummary.pendingLinkCount)}
          />
          <AuditField label="Payload hash" value={detail.payloadHash} mono wide />
          <DateField label="First seen" value={detail.dates.firstSeenAt} />
          <DateField label="Last seen" value={detail.dates.lastSeenAt} />
          <DateField label="Last changed" value={detail.dates.lastChangedAt} />
          <DateField label="Synced at" value={detail.dates.syncedAt} />
        </AuditFieldGrid>
      </OverlaySection>

      <OverlaySection title="Dados técnicos do Nomus">
        <details
          className="rounded-lg border border-border bg-card"
          data-testid="production-order-raw-json"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            Payload original do Nomus
          </summary>
          <div className="space-y-3 border-t border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Evidência técnica somente leitura. O conteúdo é exibido como texto e não executa HTML.
              </p>
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                data-testid="production-order-copy-json"
              >
                {copyFeedback === "JSON copiado." ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Copiar JSON
              </button>
            </div>
            <p className="sr-only" aria-live="polite">
              {copyFeedback}
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-100">
              {technicalJson}
            </pre>
          </div>
        </details>
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

function AuditFieldGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>;
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
