import type { MaterialMarketSituationResult } from "../lib/materialMarketSituationStatus";

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
  /** Quantidade na unidade de medida adotada. */
  quantity: number;
  freight: number;
  standardLoss: number;
  conversionFactor: number;
  status: "ACTIVE" | "INACTIVE";
  isMarketMonitored?: boolean;
  marketCriticality?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  marketMonitoringFrequencyDays?: number | null;
  marketNotes?: string | null;
  MaterialPriceHistory?: MaterialPriceHistory[];
  calculations?: {
    landedCost: number;
    effectiveCost: number;
    /** quantity × currentCost */
    totalMaterialValue: number;
  };
  marketSituation?: MaterialMarketSituationResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialMarketMonitoringInput {
  isMarketMonitored: boolean;
  marketCriticality?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  marketMonitoringFrequencyDays?: number | null;
  marketNotes?: string | null;
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
  quantity: number;
  freight: number;
  standardLoss: number;
  conversionFactor: number;
  isMarketMonitored?: boolean;
  marketCriticality?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  marketMonitoringFrequencyDays?: number | null;
  marketNotes?: string | null;
}
