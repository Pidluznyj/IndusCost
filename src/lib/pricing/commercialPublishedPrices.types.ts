export const MAX_COMMERCIAL_PUBLISHED_TABLES = 4;

/** Ordem oficial de prioridade no grid (tabela principal/default primeiro). */
export const COMMERCIAL_TABLE_CODE_PRIORITY = [
  "ATACADO",
  "VAREJO_1",
  "VAREJO_2",
  "VAREJO_3",
] as const;

export type CommercialPublishedPriceGridSort =
  | "SKU_ASC"
  | "SKU_DESC"
  | "NAME_ASC"
  | "NAME_DESC"
  | "LAST_PUBLISHED_DESC";

export type CommercialPublishedPriceGridQuery = {
  search?: string | null;
  taxRuleId?: string | null;
  marginRuleId?: string | null;
  commissionRuleId?: string | null;
  tableId?: string | null;
  referenceDate?: Date | null;
  page?: number;
  limit?: number;
  sort?: CommercialPublishedPriceGridSort;
};

export type CommercialPublishedPriceGridTable = {
  tableId: string;
  tableName: string;
  tableCode: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string | null;
  effectiveFrom: string | null;
  taxRuleId: string | null;
  taxRuleName: string | null;
  status: string;
  isPrimary?: boolean;
};

export type CommercialPublishedPriceCell = {
  tableId: string;
  tableName: string;
  versionId: string;
  priceItemId: string | null;
  salePrice: number | null;
  marginPercent: number | null;
  markup: number | null;
  commissionPercent: number | null;
  taxPercent: number | null;
  status: "PUBLISHED" | "NO_PRICE";
};

export type CommercialPublishedPriceGridRow = {
  productId: string;
  sku: string;
  productName: string;
  taxInfo: {
    fiscalRuleId: string | null;
    fiscalRuleName: string | null;
    taxPercent: number | null;
  } | null;
  prices: CommercialPublishedPriceCell[];
  lastPublishedAt: string | null;
  status: "OK" | "PARTIAL" | "NO_PRICE";
};

export type CommercialPublishedPriceGridSnapshot = {
  referenceDate: string;
  tables: CommercialPublishedPriceGridTable[];
  rows: CommercialPublishedPriceGridRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  totals: {
    tableCount: number;
    rowCount: number;
    pricedCellCount: number;
    emptyCellCount: number;
  };
};

export type CommercialPublishedPricesApiResponse = CommercialPublishedPriceGridSnapshot & {
  message: string | null;
};
