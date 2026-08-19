import type { Material } from "@/src/types/material";

export type PurchaseRequestStatus =
  | "RASCUNHO"
  | "AGUARDANDO_APROVACAO"
  | "ABERTA"
  | "REJEITADA"
  | "EM_COTACAO"
  | "CANCELADA"
  | "ENCERRADA";

export type PurchasePriority = "BAIXA" | "NORMAL" | "ALTA" | "URGENTE";
export type PurchaseLineType = "MATERIA_PRIMA" | "INDIRETO";
export type PurchaseItemLineStatus = "ABERTA" | "CANCELADA";

export interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseRequestProjectRef {
  id: string;
  code: string;
  title: string;
  status?: string;
}

export interface PurchaseRequestHistoryEventRow {
  id: string;
  action: string;
  fromStatus: PurchaseRequestStatus | null;
  toStatus: PurchaseRequestStatus | null;
  reason: string | null;
  notes: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

export interface PurchaseRequestItemRow {
  id: string;
  purchaseRequestId: string;
  lineType: PurchaseLineType;
  materialId: string | null;
  description: string;
  quantity: string | number;
  unit: string;
  costCenterId: string | null;
  financialCostCenterId?: string | null;
  desiredDate: string | null;
  priority: PurchasePriority | null;
  notes: string | null;
  suggestedSupplier: string | null;
  supplierReference: string | null;
  packagingPresentation: string | null;
  minOrderQtySuggested: string | number | null;
  lineStatus: PurchaseItemLineStatus;
  material?: Material | null;
  costCenter?: CostCenterRow | null;
}

export interface PurchaseRequestRow {
  id: string;
  number: number;
  requester: string;
  department: string;
  requestCategory: string | null;
  priority: PurchasePriority;
  status: PurchaseRequestStatus;
  justification: string;
  defaultCostCenterId: string;
  requesterEmployeeId?: string | null;
  requestCategoryId?: string | null;
  defaultFinancialCostCenterId?: string | null;
  notes: string | null;
  projectId?: string | null;
  projectCodeSnapshot?: string | null;
  projectTitleSnapshot?: string | null;
  externalReference?: string | null;
  createdAt: string;
  updatedAt: string;
  defaultCostCenter: CostCenterRow;
  project?: PurchaseRequestProjectRef | null;
  items: PurchaseRequestItemRow[];
  historyEvents?: PurchaseRequestHistoryEventRow[];
  quotations?: Array<{ id: string; code: string; status: string }>;
}

export interface PurchaseEvidenceRow {
  id: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  evidenceType: string;
  notes: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface PurchaseItemDraft {
  tempId: string;
  lineType: PurchaseLineType;
  materialId: string;
  description: string;
  quantity: number;
  unit: string;
  /** vazio = herdar do cabeçalho */
  costCenterId: string;
  /** Centro de custo OFICIAL (financeiro) selecionado na linha. */
  financialCostCenterId: string;
  desiredDate: string;
  priority: PurchasePriority | "";
  notes: string;
  suggestedSupplier: string;
  supplierReference: string;
  packagingPresentation: string;
  /** string para input controlado; vazio = sem MOQ sugerido */
  minOrderQtySuggested: string;
  lineStatus: PurchaseItemLineStatus;
}

export function emptyPurchaseItemDraft(): PurchaseItemDraft {
  return {
    tempId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}`,
    lineType: "INDIRETO",
    materialId: "",
    description: "",
    quantity: 1,
    unit: "UN",
    costCenterId: "",
    financialCostCenterId: "",
    desiredDate: "",
    priority: "",
    notes: "",
    suggestedSupplier: "",
    supplierReference: "",
    packagingPresentation: "",
    minOrderQtySuggested: "",
    lineStatus: "ABERTA",
  };
}

export const PURCHASE_REQUEST_STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  ABERTA: "Aberta",
  REJEITADA: "Rejeitada",
  EM_COTACAO: "Em cotação",
  CANCELADA: "Cancelada",
  ENCERRADA: "Encerrada",
};
