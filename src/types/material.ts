export interface MaterialPriceHistory {
  id: string;
  materialId: string;
  price: number;
  freight: number;
  effectiveDate: string;
}

export interface Material {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  supplier?: string;
  currentCost: number;
  averageCost: number;
  standardCost: number;
  freight: number;
  standardLoss: number;
  conversionFactor: number;
  status: "ACTIVE" | "INACTIVE";
  MaterialPriceHistory?: MaterialPriceHistory[];
  calculations?: {
    landedCost: number;
    effectiveCost: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaterialInput {
  code: string;
  description: string;
  unit: string;
  category: string;
  supplier?: string;
  currentCost: number;
  averageCost: number;
  standardCost: number;
  freight: number;
  standardLoss: number;
  conversionFactor: number;
}
