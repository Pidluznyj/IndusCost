import { Material } from "./material";
export interface ProductBOM {
  id?: string;
  materialId: string;
  material?: Material;
  quantity: number;
  lossPercentage: number;
  notes?: string;
}

export interface ProductRouting {
  id?: string;
  sequence: number;
  description?: string;
  machineId: string;
  machine?: any;
  roleId: string;
  role?: any;
  setupTimeMin: number;
  operationTimeMin: number;
  efficiencyExpected: number;
  notes?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string;
  version: string;
  status: "ACTIVE" | "DRAFT" | "OBSOLETE";
  defaultLotSize: number;
  bom: ProductBOM[];
  routing: ProductRouting[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string;
  version: string;
  defaultLotSize: number;
  bom: ProductBOM[];
  routing: ProductRouting[];
}
