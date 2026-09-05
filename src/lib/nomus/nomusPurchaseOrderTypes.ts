/** Tipos do espelho read-only de Pedido de Compra Nomus. Separado de PurchaseOrder interno. */

export const NOMUS_PURCHASE_ORDER_STAGES = [
  "CANCELED",
  "OPEN",
  "APPROVED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "UNKNOWN",
] as const;

export type NomusPurchaseOrderStage = (typeof NOMUS_PURCHASE_ORDER_STAGES)[number];

export type JsonObject = Record<string, unknown>;

export type MappedNomusPurchaseOrderItem = {
  lineIndex: number;
  lineExternalId: number | null;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  unit: string | null;
  orderedQuantity: number | null;
  receivedQuantity: number | null;
  remainingQuantity: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
  rawPayload: JsonObject;
  payloadHash: string;
};

export type MappedNomusPurchaseOrder = {
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  statusRaw: string | null;
  canceled: boolean | null;
  stage: NomusPurchaseOrderStage;
  issuedAt: Date | null;
  expectedAt: Date | null;
  createdAtNomus: Date | null;
  modifiedAtNomus: Date | null;
  paymentTerms: string | null;
  comments: string | null;
  currency: string | null;
  totalAmount: number | null;
  discountAmount: number | null;
  freightAmount: number | null;
  itemCount: number;
  orderedQuantity: number | null;
  receivedQuantity: number | null;
  remainingQuantity: number | null;
  rawPayload: JsonObject;
  payloadHash: string;
  items: MappedNomusPurchaseOrderItem[];
};

export type MapNomusPurchaseOrderResult =
  | { ok: true; row: MappedNomusPurchaseOrder }
  | { ok: false; reasons: string[]; externalId: number | null };
