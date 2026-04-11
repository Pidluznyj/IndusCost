import type { Material } from "@/src/types/material";

export type PurchaseRequestStatus = "RASCUNHO" | "ABERTA" | "CANCELADA" | "ENCERRADA";
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

export interface PurchaseRequestItemRow {
  id: string;
  purchaseRequestId: string;
  lineType: PurchaseLineType;
  materialId: string | null;
  description: string;
  quantity: string | number;
  unit: string;
  costCenterId: string | null;
  desiredDate: string | null;
  priority: PurchasePriority | null;
  notes: string | null;
  suggestedSupplier: string | null;
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
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  defaultCostCenter: CostCenterRow;
  items: PurchaseRequestItemRow[];
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
  desiredDate: string;
  priority: PurchasePriority | "";
  notes: string;
  suggestedSupplier: string;
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
    desiredDate: "",
    priority: "",
    notes: "",
    suggestedSupplier: "",
    lineStatus: "ABERTA",
  };
}
