/**
 * Vendedor do pedido na Auditoria 360º — resolução canônica Nomus.
 *
 * Usa `externalSellerId` + aliases/CommissionPerson (vários cadastros → um nome).
 * Não usa Responsável Comercial do CRM como vendedor do pedido.
 */
import type { CommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.js";
import {
  buildSalesOrderNomusSellerDto,
  formatSalesOrderNomusSellerListLabel,
  type SalesOrderNomusSellerApiStatus,
} from "@/src/lib/salesOrderNomusSellerDisplay.js";
import { extractNomusSellerFromPedido } from "@/src/lib/salesOrderNomusSeller.shared.js";

export type OrderFullAuditSellerDisplay = {
  orderSellerName: string | null;
  orderSellerExternalId: number | null;
  resolutionStatus: SalesOrderNomusSellerApiStatus;
  /** Nome bruto Nomus antes da consolidação (auditoria). */
  rawNomusSellerName: string | null;
};

function asPedidoRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  // Payload às vezes vem envelopado.
  const obj = raw as Record<string, unknown>;
  if (obj.pedido && typeof obj.pedido === "object" && !Array.isArray(obj.pedido)) {
    return obj.pedido as Record<string, unknown>;
  }
  return obj;
}

/**
 * Resolve o nome de exibição do vendedor do pedido para Auditoria 360º / resumo.
 */
export function resolveOrderFullAuditSellerDisplay(
  order: {
    externalSellerId?: number | null;
    nomusSellerName?: string | null;
    issueDate?: Date | string | null;
    nomusRawResponse?: unknown;
  },
  ctx: CommissionSellerIdentityContext
): OrderFullAuditSellerDisplay {
  let externalSellerId =
    order.externalSellerId != null && order.externalSellerId > 0
      ? order.externalSellerId
      : null;
  let rawNomusSellerName = order.nomusSellerName?.trim() || null;

  if (externalSellerId == null || !rawNomusSellerName) {
    const pedido = asPedidoRecord(order.nomusRawResponse);
    if (pedido) {
      const extracted = extractNomusSellerFromPedido(pedido);
      if (externalSellerId == null && extracted.externalSellerId != null) {
        externalSellerId = extracted.externalSellerId;
      }
      if (!rawNomusSellerName && extracted.nomusSellerName) {
        rawNomusSellerName = extracted.nomusSellerName;
      }
    }
  }

  const dto = buildSalesOrderNomusSellerDto(
    { externalSellerId, issueDate: order.issueDate },
    ctx
  );

  if (dto.resolutionStatus === "NO_SELLER") {
    return {
      orderSellerName: rawNomusSellerName,
      orderSellerExternalId: null,
      resolutionStatus: "NO_SELLER",
      rawNomusSellerName,
    };
  }

  if (
    dto.resolutionStatus === "RESOLVED" ||
    dto.resolutionStatus === "RESOLVED_BY_ALIAS"
  ) {
    return {
      orderSellerName: dto.name?.trim() || rawNomusSellerName,
      orderSellerExternalId: dto.externalSellerId,
      resolutionStatus: dto.resolutionStatus,
      rawNomusSellerName,
    };
  }

  // SELLER_UNRESOLVED: preferir nome bruto Nomus; senão rótulo com ID.
  return {
    orderSellerName:
      rawNomusSellerName || formatSalesOrderNomusSellerListLabel(dto),
    orderSellerExternalId: dto.externalSellerId,
    resolutionStatus: "SELLER_UNRESOLVED",
    rawNomusSellerName,
  };
}
