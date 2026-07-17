/**
 * DS-04.2 / DS-04.3 — Contrato do detalhe de Documento de Saída.
 */

import type {
  OutputDocumentItemLinkStatus,
  OutputDocumentLinkOrigin,
} from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";
import type {
  OutputDocumentFinancialOrigin,
  OutputDocumentFinancialStatus,
  OutputDocumentFinancialTitleDto,
} from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import type { OutputDocumentLinkClassification } from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";
import type { LinkSourceKind } from "@/src/lib/output-documents/auditOutputDocumentsLinks.js";

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

export type OutputDocumentDetailOfficialSeller = {
  externalSellerId: number | null;
  name: string | null;
};

export type OutputDocumentDetailLinkedOrder = {
  salesOrderId: string;
  orderCode: string | null;
  issueDate: string | null;
  status: string | null;
  officialSeller: OutputDocumentDetailOfficialSeller;
  /** Valor líquido oficial do pedido (não é o total do documento). */
  orderValue: number | null;
  /** Valor alocado deste documento a este pedido. */
  allocatedValue: number;
  /** Cobertura = alocado / total do documento (%). */
  coveragePercent: number | null;
  sources: Array<"sales_order_nfe_link" | "order_to_cash_fact">;
};

export type OutputDocumentDetailOrderShare = {
  salesOrderId: string;
  orderCode: string | null;
  allocatedValue: number;
  shareOfDocumentPercent: number | null;
};

export type OutputDocumentDetailAllocations = {
  documentTotalValue: number;
  allocatedToOrders: number;
  unallocatedBalance: number;
  overAllocation: number;
  coveragePercent: number | null;
  coverageStatus: string;
  orderShares: OutputDocumentDetailOrderShare[];
};

export type OutputDocumentDetailNfe = {
  externalId: number;
  numero: string | null;
  serie: string | null;
  status: number | null;
  isCancelled: boolean;
  dataEmissao: string | null;
  dataProcessamento: string | null;
  totalValue: number | null;
  /** Chave mascarada (nunca chave completa nesta etapa). */
  chaveMasked: string | null;
  foundLocally: boolean;
  isPrimary: boolean;
  sources: LinkSourceKind[];
};

export type OutputDocumentDetailFinancial = {
  status: OutputDocumentFinancialStatus;
  statusReasons: string[];
  financialOrigin: OutputDocumentFinancialOrigin;
  financialOriginReasons: string[];
  receivableTotal: number;
  open: number;
  received: number;
  nextDueDate: string | null;
  installmentCount: number;
  titles: OutputDocumentFinancialTitleDto[];
  documentPaymentTermsRaw: string | null;
  alerts: string[];
};

export type OutputDocumentDetailLinkAudit = {
  classification: OutputDocumentLinkClassification;
  sources: LinkSourceKind[];
  reasons: string[];
};

export type OutputDocumentDetailAudit = {
  stockDocumentId: string;
  stockDocumentExternalId: number;
  idNfe: number | null;
  payloadHash: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  presentInLastPayload: boolean;
  syncedAt: string;
  nfeLink: OutputDocumentDetailLinkAudit;
  ordersLink: OutputDocumentDetailLinkAudit;
  receivablesLink: OutputDocumentDetailLinkAudit;
  o2cPresent: boolean;
  o2cRunIds: string[];
  conflicts: string[];
};

export type OutputDocumentDetailInconsistency = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type OutputDocumentDetailPayload = {
  document: OutputDocumentDetailHeader;
  items: OutputDocumentDetailItem[];
  values: OutputDocumentDetailValues;
  resolution: OutputDocumentDetailResolution;
  orders: OutputDocumentDetailLinkedOrder[];
  allocations: OutputDocumentDetailAllocations;
  nfes: OutputDocumentDetailNfe[];
  financial: OutputDocumentDetailFinancial | null;
  audit: OutputDocumentDetailAudit | null;
  inconsistencies: OutputDocumentDetailInconsistency[];
  /** Presente somente com permissão raw + includeRaw=true. */
  raw?: {
    document: unknown;
    items: unknown[];
  } | null;
  permissions: {
    canViewFinancial: boolean;
    canViewAudit: boolean;
    canViewRaw: boolean;
  };
  generatedAt: string;
};
