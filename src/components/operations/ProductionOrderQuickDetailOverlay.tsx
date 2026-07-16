import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Overlay,
  OverlayBadge,
  OverlayBody,
  OverlayHeader,
  OverlaySection,
} from "@/src/components/ui/overlay";
import {
  fetchProductionOrderDetail,
  type ProductionOrderDetailResponse,
} from "@/src/lib/productionOrdersClient";
import {
  classifyProductionOrdersListError,
  formatProductionOrderDateTime,
  formatProductionOrderQuantity,
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

  useEffect(() => {
    if (!productionOrderId) {
      setDetail(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
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

  const titleId = "production-order-quick-detail-title";
  return (
    <Overlay
      open={productionOrderId != null}
      onClose={onClose}
      size="lg"
      ariaLabelledBy={titleId}
      testId="production-order-quick-detail"
    >
      <OverlayHeader
        titleId={titleId}
        eyebrow="Operações · Ordem de Produção"
        title={detail?.identification.name ?? "Detalhe da Ordem de Produção"}
        subtitle={
          detail ? `ID Nomus #${detail.identification.externalId}` : "Consulta somente leitura"
        }
        onClose={onClose}
      />
      <OverlayBody>
        {loading ? (
          <div
            className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
            data-testid="production-order-detail-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando detalhe…
          </div>
        ) : error ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            data-testid="production-order-detail-error"
          >
            {error}
          </div>
        ) : detail ? (
          <div className="space-y-4" data-testid="production-order-detail-content">
            <OverlaySection title="Resumo">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DetailField label="Status">
                  <OverlayBadge tone="slate">
                    {detail.identification.status ?? "Sem status"}
                  </OverlayBadge>
                </DetailField>
                <DetailField label="Tipo" value={detail.identification.tipo} />
                <DetailField label="Prioridade" value={detail.identification.priority} />
                <DetailField label="Empresa" value={detail.company.companyName} />
                <DetailField
                  label="Quantidade"
                  value={formatProductionOrderQuantity(
                    detail.product.quantity,
                    detail.product.unit
                  )}
                />
                <DetailField label="Produto" value={detail.product.productCode} />
              </div>
            </OverlaySection>
            <OverlaySection title="Datas">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DetailField
                  label="Abertura"
                  value={formatProductionOrderDateTime(detail.dates.openedAt)}
                />
                <DetailField
                  label="Planejada"
                  value={formatProductionOrderDateTime(detail.dates.plannedAt)}
                />
                <DetailField
                  label="Encerramento"
                  value={formatProductionOrderDateTime(detail.dates.closedAt)}
                />
              </div>
            </OverlaySection>
            <OverlaySection title="Vínculos de Pedido">
              <p className="text-sm text-muted-foreground">
                {detail.auditSummary.currentLinkCount} atual(is),{" "}
                {detail.auditSummary.pendingLinkCount} pendente(s) e{" "}
                {detail.auditSummary.removedLinkCount} removido(s).
              </p>
            </OverlaySection>
          </div>
        ) : null}
      </OverlayBody>
    </Overlay>
  );
}

function DetailField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">
        {children ?? value ?? "—"}
      </div>
    </div>
  );
}
