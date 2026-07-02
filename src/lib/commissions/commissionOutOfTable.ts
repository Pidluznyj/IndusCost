/**
 * Comissão mínima quando o preço vendido fica abaixo da tabela Atacado.
 * Constantes centralizadas do motor — não espalhar o percentual em outros arquivos.
 */

export const OUT_OF_TABLE_COMMISSION_PERCENT = 1;

export const OUT_OF_TABLE_TIER_CODE = "PRECO_FORA_DA_TABELA" as const;

export const OUT_OF_TABLE_TIER_LABEL = "Preço fora da tabela";

export const OUT_OF_TABLE_PRICE_AUDIT_TYPE = "OUT_OF_TABLE_PRICE_COMMISSION" as const;

export const OUT_OF_TABLE_PRICE_TOOLTIP =
  "Preço vendido abaixo da tabela Atacado. Comissão mínima de 1% aplicada.";

export const OUT_OF_TABLE_PRICE_AUDIT_MESSAGE = OUT_OF_TABLE_PRICE_TOOLTIP;

/** Tipos de auditoria informativos — não bloqueiam cálculo nem pagamento. */
export const NON_BLOCKING_COMMISSION_AUDIT_TYPES = new Set<string>([
  OUT_OF_TABLE_PRICE_AUDIT_TYPE,
  "ORDER_WITHOUT_REPRESENTATIVE",
]);

export function isNonBlockingCommissionAuditType(type: string): boolean {
  return NON_BLOCKING_COMMISSION_AUDIT_TYPES.has(type);
}

export function hasBlockingCommissionAuditTypes(types: string[]): boolean {
  return types.some((t) => !isNonBlockingCommissionAuditType(t));
}

export function isOutOfTablePriceMetadata(metadataJson: unknown): boolean {
  if (!metadataJson || typeof metadataJson !== "object") return false;
  const meta = metadataJson as Record<string, unknown>;
  return (
    meta.outOfTablePrice === true || meta.tierCode === OUT_OF_TABLE_TIER_CODE
  );
}
