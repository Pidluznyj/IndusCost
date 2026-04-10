import { Material } from "./material";

export type ItemType = "PRODUCT" | "COMPONENT" | "MATERIAL";

export interface ProductBOM {
  id?: string;
  materialId?: string;
  material?: Material;
  childProductId?: string;
  childProduct?: Product;
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
  cycleTimeSeconds?: number;
  cavities?: number;
  notes?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string;
  type: ItemType;
  version: string;
  status: "ACTIVE" | "DRAFT" | "OBSOLETE";
  defaultLotSize: number;
  
  cycleTimeSeconds?: number | null;
  cavities?: number | null;
  setupTimeMin?: number | null;
  efficiencyExpected?: number | null;
  
  ProductBOM: ProductBOM[];
  ProductRouting: ProductRouting[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string;
  type: ItemType;
  version: string;
  defaultLotSize: number;
  
  cycleTimeSeconds?: number | string;
  cavities?: number | string;
  setupTimeMin?: number | string;
  efficiencyExpected?: number | string;
  
  bom: ProductBOM[];
  routing: ProductRouting[];
}