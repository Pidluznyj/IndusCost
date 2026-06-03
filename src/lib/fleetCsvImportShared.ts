export const FLEET_IMPORT_CONFIRM_TOKEN = "APLICAR_IMPORTACAO_FROTA";

export type FleetImportRowResult = {
  line: number;
  valid: boolean;
  action?: "create" | "update" | "skip";
  errors: string[];
  warnings: string[];
  preview?: Record<string, unknown>;
};

export type FleetImportSummary = {
  mode: "preview" | "apply";
  totalRows: number;
  validCount: number;
  invalidCount: number;
  wouldCreate: number;
  wouldUpdate: number;
  created: number;
  updated: number;
  skipped: number;
  rows: FleetImportRowResult[];
};
