/**
 * DS-04.2 — Contrato do detalhe geral + itens de Documento de Saída.
 */

import type {
  OutputDocumentItemLinkStatus,
  OutputDocumentLinkOrigin,
} from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";

export type OutputDocumentDetailCompany = {
  externalId: number | null;
  name: string | null;
};

export type OutputDocumentDetailCustomer = {
  externalId: number | null;
  name: string | null;
};

export type OutputDocumentDetailCancellation = {
  isCancelled: boolean;
  cancelledAt: string | null;
  reason: string | null;
};

export type OutputDocumentDetailSync = {
  syncedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  presentInLastPayload: boolean;
};

export type OutputDocumentDetailHeader = {
  id: string;
  externalId: number;
  documentNumber: string | null;
  tipoDocumentoEstoque: string | null;
  statusRaw: string | null;
  cancellation: OutputDocumentDetailCancellation;
  company: OutputDocumentDetailCompany;
  customer: OutputDocumentDetailCustomer;
  dataDocumento: string | null;
  movementDate: string | null;
  idNfe: number | null;
  paymentTermsRaw: string | null;
  /** Valor do cabeçalho stage (uma vez). */
  totalValue: number | null;
  sync: OutputDocumentDetailSync;
};

export type OutputDocumentDetailItemProductLink = {
  externalProductId: number | null;
  /** true quando há externalProductId positivo no stage. */
  hasProductId: boolean;
};

export type OutputDocumentDetailItemLink = {
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  orderCode: string | null;
  allocatedValue: number;
  quantityUsedForOrder: number;
  source: "order_to_cash_fact" | "product_match";
};

export type OutputDocumentDetailItem = {
  id: string;
  externalItemId: number | null;
  externalProductId: number | null;
  quantity: number;
  unitValue: number;
  /** Total do item (uma vez). */
  totalValue: number;
  allocatedValue: number;
  unallocatedBalance: number;
  linkStatus: OutputDocumentItemLinkStatus;
  linkOrigin: OutputDocumentLinkOrigin;
  productLink: OutputDocumentDetailItemProductLink;
  links: OutputDocumentDetailItemLink[];
  alerts: string[];
};

export type OutputDocumentDetailValues = {
  totalValue: number | null;
  totalValueSource: "stage_header" | "items_sum" | "zero";
  itemsSum: number;
  allocatedToOrders: number;
  unallocatedBalance: number;
  overAllocation: number;
  coverageStatus: string;
};

export type OutputDocumentDetailResolution = {
  listedFromStage: true;
  dependsOnO2cForListing: false;
  itemCount: number;
  itemsResolved: number;
  itemsUnresolved: number;
  itemsPartial: number;
  itemsConflict: number;
};

export type OutputDocumentDetailPayload = {
  document: OutputDocumentDetailHeader;
  items: OutputDocumentDetailItem[];
  values: OutputDocumentDetailValues;
  resolution: OutputDocumentDetailResolution;
  generatedAt: string;
};
