import type { DreCostCenterRole } from "@/src/lib/financeDreCostCenterRoles.js";

export type DreCostCenterMappingSource = "SEED" | "MANUAL";

export type FinanceDreCostCenterMappingRow = {
  costCenterId: string;
  code: string;
  name: string;
  status: string;
  role: DreCostCenterRole;
  roleLabel: string;
  source: DreCostCenterMappingSource;
  updatedAt: string | null;
};
