// src/lib/importer/types.ts
export interface ImportColumnConfig {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "decimal";
  required?: boolean;
  description?: string;
  example?: string;
  validation?: (value: any) => string | null;
  transform?: (value: any) => any;
}

export interface ImportEntityConfig {
  entityName: string;
  columns: ImportColumnConfig[];
}

export interface ImportError {
  row: number;
  column?: string;
  message: string;
}

export interface ImportResult<T> {
  data: T[];
  errors: ImportError[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}
