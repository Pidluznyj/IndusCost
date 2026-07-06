import type { UnclassifiedCauseUi } from "@/src/lib/financeUnclassifiedPayablesUi";

export type UnclassifiedGroupTitlesAppliedFilters = {
  year?: number;
  month?: number;
  companyName?: string;
  status?: string;
  classification?: string;
  cause?: string;
  openOnly?: boolean;
  search?: string;
};

export type UnclassifiedGroupTitleRow = {
  externalId: number;
  documentNumber: string | null;
  supplierName: string | null;
  supplierDocument: string | null;
  issueDate: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  paymentDate: string | null;
  amount: number;
  status: string;
  statusLabel: string;
  cause: UnclassifiedCauseUi;
  description: string;
  rawDescriptionSource: string | null;
};

export type UnclassifiedGroupTitlesPayload = {
  group: {
    key: string;
    supplierName: string;
    supplierDocument: string | null;
    cause: UnclassifiedCauseUi | null;
    suggestion: string;
  };
  summary: {
    titlesCount: number;
    totalAmount: number;
  };
  rows: UnclassifiedGroupTitleRow[];
  appliedFilters: UnclassifiedGroupTitlesAppliedFilters;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalRows: number;
  };
};

export const UNCLASSIFIED_GROUP_TITLES_SCOPE_NOTE =
  "Somente leitura — não altera classificação nem dados do Contas a Pagar." as const;
