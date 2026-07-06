import {
  FINANCE_CASH_FLOW_DATE_BASE_OPTIONS,
  FINANCE_CASH_FLOW_INVOICE_OPTIONS,
  FINANCE_CASH_FLOW_MONTH_OPTIONS,
  FINANCE_CASH_FLOW_STATUS_OPTIONS,
  FINANCE_CASH_FLOW_VIEW_OPTIONS,
  type FinanceCashFlowDashboardPayload,
  type FinanceCashFlowReconciliation,
  type FinanceCashFlowUiFilters,
} from "./financeCashFlowDashboardTypes.js";
import {
  FINANCE_AUDIT_RULES_EXECUTIVE,
  FINANCE_AUDIT_SANITIZATION_INTRO,
  FINANCE_AUDIT_SECTION_COMPARISON,
  FINANCE_AUDIT_SECTION_FILTERS,
  FINANCE_AUDIT_SECTION_IGNORED,
  FINANCE_AUDIT_SECTION_RECONCILIATION,
  FINANCE_AUDIT_SECTION_RULES,
  FINANCE_AUDIT_SECTION_SOURCES,
  FINANCE_AUDIT_SECTION_SYNC,
  FINANCE_AUDIT_SECTION_TECHNICAL,
  FINANCE_AP_AUDIT_RULES,
  FINANCE_AP_CLASSIFICATION_AUDIT_NOTES,
  FINANCE_BILLING_AUDIT_RULES,
  FINANCE_BILLING_COMPARISON_NOTE,
} from "./financeDataAuditCopy.js";
import type { FinanceDataSanitization } from "./financeInternalGroupExclusions.js";
import { totalFinanceDataSanitizationIgnored } from "./financeInternalGroupExclusions.js";
import { formatFinanceDateTime } from "./financeAccountsReceivableFormat.js";
import { FINANCE_CASH_FLOW_SYNC_SCOPE } from "./financeFilterScope.js";

export type FinanceDataAuditListItem = {
  label: string;
  value: string;
  hint?: string;
};

export type FinanceDataAuditStatusItem = {
  text: string;
  ok?: boolean;
};

export type FinanceDataAuditSection =
  | {
      kind: "list";
      id: string;
      title: string;
      items: FinanceDataAuditListItem[];
    }
  | {
      kind: "paragraphs";
      id: string;
      title: string;
      paragraphs: string[];
    }
  | {
      kind: "status";
      id: string;
      title: string;
      items: FinanceDataAuditStatusItem[];
    };

export type FinanceSanitizationAuditRow = {
  label: string;
  count: number;
};

export function buildFinanceSanitizationAuditRows(
  data: FinanceDataSanitization
): FinanceSanitizationAuditRow[] {
  return [
    { label: "Intercompany (contas a receber)", count: data.ignoredInternalGroupReceivables },
    { label: "Intercompany (contas a pagar)", count: data.ignoredInternalGroupPayables },
    { label: "Títulos fantasma (AR)", count: data.ignoredGhostReceivables },
    { label: "AR fora da última sync", count: data.ignoredStaleReceivables },
    { label: "AP fora da última sync", count: data.ignoredStalePayables },
    { label: "Pedidos de compra (AP)", count: data.ignoredPurchaseOrderAgendaPayables },
    {
      label: "AR vencido sem NF",
      count: data.ignoredOverdueWithoutFiscalDocumentReceivables,
    },
  ].filter((row) => row.count > 0);
}

export function countFinanceSanitizationWarnings(data?: FinanceDataSanitization | null): number {
  if (!data) return 0;
  return buildFinanceSanitizationAuditRows(data).length;
}

export function countFinanceReconciliationWarnings(
  reconciliation?: FinanceCashFlowReconciliation | null
): number {
  if (!reconciliation) return 0;
  let n = 0;
  if (!reconciliation.receivable.matchesLedger) n += 1;
  if (!reconciliation.payable.matchesLedger) n += 1;
  if (!reconciliation.netMatchesLedger) n += 1;
  if (!reconciliation.receivable.matchesArOpen) n += 1;
  if (!reconciliation.payable.matchesApOpen) n += 1;
  return n;
}

export function countFinanceDataAuditWarnings(input: {
  dataSanitization?: FinanceDataSanitization | null;
  reconciliation?: FinanceCashFlowReconciliation | null;
}): number {
  return (
    countFinanceSanitizationWarnings(input.dataSanitization) +
    countFinanceReconciliationWarnings(input.reconciliation)
  );
}

function optionLabel<T extends { value: string; label: string }>(
  options: readonly T[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function buildCashFlowAppliedFilterItems(
  filters: FinanceCashFlowUiFilters
): FinanceDataAuditListItem[] {
  const items: FinanceDataAuditListItem[] = [];
  if (filters.year.trim()) items.push({ label: "Ano", value: filters.year });
  if (filters.month.trim()) {
    items.push({
      label: "Mês",
      value: optionLabel(FINANCE_CASH_FLOW_MONTH_OPTIONS, filters.month),
    });
  }
  if (filters.companyName.trim()) {
    items.push({ label: "Empresa", value: filters.companyName.trim() });
  }
  items.push({
    label: "Visão",
    value: optionLabel(FINANCE_CASH_FLOW_VIEW_OPTIONS, filters.viewMode),
  });
  items.push({
    label: "Data base",
    value: optionLabel(FINANCE_CASH_FLOW_DATE_BASE_OPTIONS, filters.dateBase),
  });
  items.push({
    label: "Status",
    value: optionLabel(FINANCE_CASH_FLOW_STATUS_OPTIONS, filters.status),
  });
  if (filters.customerName.trim()) {
    items.push({ label: "Cliente", value: filters.customerName.trim() });
  }
  if (filters.supplierName.trim()) {
    items.push({ label: "Fornecedor", value: filters.supplierName.trim() });
  }
  if (filters.personCnpj.trim()) {
    items.push({ label: "CNPJ/CPF", value: filters.personCnpj.trim() });
  }
  if (filters.paymentMethodName.trim()) {
    items.push({ label: "Forma de pagamento", value: filters.paymentMethodName.trim() });
  }
  if (filters.bankAccountName.trim()) {
    items.push({ label: "Conta bancária", value: filters.bankAccountName.trim() });
  }
  if (filters.invoiceIssued !== "all") {
    items.push({
      label: "NF emitida",
      value: optionLabel(FINANCE_CASH_FLOW_INVOICE_OPTIONS, filters.invoiceIssued),
    });
  }
  return items;
}

export function buildFinanceCashFlowReconciliationStatus(
  reconciliation: FinanceCashFlowReconciliation
): FinanceDataAuditStatusItem[] {
  const allOk =
    reconciliation.receivable.matchesArOpen &&
    reconciliation.payable.matchesApOpen &&
    reconciliation.netMatchesLedger;

  return [
    {
      text: allOk
        ? "Fluxo conciliado com Contas a Receber e Contas a Pagar."
        : "Há divergências entre fluxo, ledger e dashboards AR/AP.",
      ok: allOk,
    },
    {
      text: reconciliation.receivable.matchesArOpen
        ? "Entradas previstas batem com Contas a Receber."
        : "Entradas previstas com divergência em relação ao AR.",
      ok: reconciliation.receivable.matchesArOpen,
    },
    {
      text: reconciliation.payable.matchesApOpen
        ? "Saídas previstas batem com Contas a Pagar."
        : "Saídas previstas com divergência em relação ao AP.",
      ok: reconciliation.payable.matchesApOpen,
    },
  ];
}

export function buildFinanceCashFlowAuditSections(
  payload: FinanceCashFlowDashboardPayload | null,
  appliedFilters: FinanceCashFlowUiFilters
): FinanceDataAuditSection[] {
  const lastSync = payload?.cards.lastSyncAt ?? null;
  const generatedAt = payload?.generatedAt ?? null;
  const sanitization = payload?.dataSanitization;
  const ignoredRows = sanitization ? buildFinanceSanitizationAuditRows(sanitization) : [];
  const totalIgnored = sanitization ? totalFinanceDataSanitizationIgnored(sanitization) : 0;

  const sections: FinanceDataAuditSection[] = [
    {
      kind: "list",
      id: "sources",
      title: FINANCE_AUDIT_SECTION_SOURCES,
      items: [
        { label: "Entradas", value: "Contas a Receber (Nomus)" },
        { label: "Saídas", value: "Contas a Pagar (Nomus)" },
      ],
    },
    {
      kind: "list",
      id: "sync",
      title: FINANCE_AUDIT_SECTION_SYNC,
      items: [
        {
          label: "Dados combinados AR/AP",
          value: lastSync ? formatFinanceDateTime(lastSync) : "—",
          hint: FINANCE_CASH_FLOW_SYNC_SCOPE,
        },
        {
          label: "Calculado em",
          value: generatedAt ? formatFinanceDateTime(generatedAt) : "—",
        },
      ],
    },
    {
      kind: "list",
      id: "filters",
      title: FINANCE_AUDIT_SECTION_FILTERS,
      items: buildCashFlowAppliedFilterItems(appliedFilters),
    },
    {
      kind: "paragraphs",
      id: "rules",
      title: FINANCE_AUDIT_SECTION_RULES,
      paragraphs: [...FINANCE_AUDIT_RULES_EXECUTIVE, FINANCE_AUDIT_SANITIZATION_INTRO],
    },
  ];

  if (ignoredRows.length > 0 || totalIgnored > 0) {
    sections.push({
      kind: "list",
      id: "ignored",
      title: FINANCE_AUDIT_SECTION_IGNORED,
      items: ignoredRows.map((row) => ({
        label: row.label,
        value: String(row.count),
      })),
    });
  }

  if (payload?.reconciliation) {
    sections.push({
      kind: "status",
      id: "reconciliation",
      title: FINANCE_AUDIT_SECTION_RECONCILIATION,
      items: buildFinanceCashFlowReconciliationStatus(payload.reconciliation),
    });
  }

  return sections;
}

export function buildFinanceAuditItemsFromChips(
  chips: Array<{ label: string }>
): FinanceDataAuditListItem[] {
  if (chips.length === 0) {
    return [{ label: "Filtros", value: "Padrão do sistema" }];
  }
  return chips.map((chip) => {
    const sep = chip.label.indexOf(":");
    if (sep === -1) return { label: chip.label, value: "—" };
    return {
      label: chip.label.slice(0, sep).trim(),
      value: chip.label.slice(sep + 1).trim(),
    };
  });
}

export function buildFinanceArApAuditSections(input: {
  moduleLabel: "Contas a Receber" | "Contas a Pagar";
  nomusSource: string;
  lastSyncAt: string | null | undefined;
  generatedAt: string | null | undefined;
  lastSyncHint?: string;
  appliedFilterItems: FinanceDataAuditListItem[];
  dataSanitization?: FinanceDataSanitization | null;
  rules?: readonly string[];
}): FinanceDataAuditSection[] {
  const ignoredRows = input.dataSanitization
    ? buildFinanceSanitizationAuditRows(input.dataSanitization)
    : [];
  const rules = input.rules ?? [...FINANCE_AUDIT_RULES_EXECUTIVE, FINANCE_AUDIT_SANITIZATION_INTRO];

  const sections: FinanceDataAuditSection[] = [
    {
      kind: "list",
      id: "sources",
      title: FINANCE_AUDIT_SECTION_SOURCES,
      items: [{ label: input.moduleLabel, value: input.nomusSource }],
    },
    {
      kind: "list",
      id: "sync",
      title: FINANCE_AUDIT_SECTION_SYNC,
      items: [
        {
          label: "Última sync (filtro atual)",
          value: input.lastSyncAt ? formatFinanceDateTime(input.lastSyncAt) : "—",
          hint: input.lastSyncHint,
        },
        {
          label: "Calculado em",
          value: input.generatedAt ? formatFinanceDateTime(input.generatedAt) : "—",
        },
      ],
    },
    {
      kind: "list",
      id: "filters",
      title: FINANCE_AUDIT_SECTION_FILTERS,
      items: input.appliedFilterItems,
    },
    {
      kind: "paragraphs",
      id: "rules",
      title: FINANCE_AUDIT_SECTION_RULES,
      paragraphs: [...rules],
    },
  ];

  if (ignoredRows.length > 0) {
    sections.push({
      kind: "list",
      id: "ignored",
      title: FINANCE_AUDIT_SECTION_IGNORED,
      items: ignoredRows.map((row) => ({
        label: row.label,
        value: String(row.count),
      })),
    });
  }

  return sections;
}

export function buildFinanceApAuditSections(input: {
  lastSyncAt: string | null | undefined;
  generatedAt: string | null | undefined;
  lastSyncHint?: string;
  appliedFilterItems: FinanceDataAuditListItem[];
  dataSanitization?: FinanceDataSanitization | null;
}): FinanceDataAuditSection[] {
  const sections = buildFinanceArApAuditSections({
    moduleLabel: "Contas a Pagar",
    nomusSource: "NomusAccountsPayable — sincronizado do Nomus",
    lastSyncAt: input.lastSyncAt,
    generatedAt: input.generatedAt,
    lastSyncHint: input.lastSyncHint,
    appliedFilterItems: input.appliedFilterItems,
    dataSanitization: input.dataSanitization,
    rules: [...FINANCE_AP_AUDIT_RULES],
  });
  const classificationSection: FinanceDataAuditSection = {
    kind: "paragraphs",
    id: "ap-classification",
    title: "Classificação financeira (centro de custo)",
    paragraphs: [...FINANCE_AP_CLASSIFICATION_AUDIT_NOTES],
  };
  const ignoredIndex = sections.findIndex((section) => section.id === "ignored");
  if (ignoredIndex >= 0) {
    sections.splice(ignoredIndex, 0, classificationSection);
  } else {
    sections.push(classificationSection);
  }
  return sections;
}

export function buildFinanceBillingAuditSections(input: {
  generatedAt: string | null | undefined;
  lastInvoicedAt: string | null | undefined;
  periodLabel: string | null | undefined;
  appliedFilterItems: FinanceDataAuditListItem[];
}): FinanceDataAuditSection[] {
  return [
    {
      kind: "list",
      id: "sources",
      title: FINANCE_AUDIT_SECTION_SOURCES,
      items: [
        { label: "Fonte oficial", value: "NF-e fiscal autorizada" },
        { label: "Base", value: "NomusNfe" },
        { label: "Valor considerado", value: "Valor líquido da NF-e" },
        {
          label: "Data considerada",
          value: "Emissão da NF no XML, quando disponível",
        },
      ],
    },
    {
      kind: "paragraphs",
      id: "comparison",
      title: FINANCE_AUDIT_SECTION_COMPARISON,
      paragraphs: [FINANCE_BILLING_COMPARISON_NOTE],
    },
    {
      kind: "list",
      id: "sync",
      title: FINANCE_AUDIT_SECTION_SYNC,
      items: [
        {
          label: "Período gerencial",
          value: input.periodLabel ?? "—",
        },
        {
          label: "Último faturamento",
          value: input.lastInvoicedAt ? formatFinanceDateTime(input.lastInvoicedAt) : "—",
        },
        {
          label: "Calculado em",
          value: input.generatedAt ? formatFinanceDateTime(input.generatedAt) : "—",
        },
      ],
    },
    {
      kind: "list",
      id: "filters",
      title: FINANCE_AUDIT_SECTION_FILTERS,
      items: input.appliedFilterItems,
    },
    {
      kind: "paragraphs",
      id: "rules",
      title: FINANCE_AUDIT_SECTION_RULES,
      paragraphs: [...FINANCE_BILLING_AUDIT_RULES],
    },
  ];
}

export function buildFinanceModuleTechnicalAuditSection(input: {
  endpoint: string;
  recordCount?: number | null;
  notes?: string[];
}): FinanceDataAuditSection {
  const items: FinanceDataAuditListItem[] = [
    { label: "Endpoint", value: input.endpoint },
  ];
  if (input.recordCount != null && Number.isFinite(input.recordCount)) {
    items.push({ label: "Registros considerados", value: String(input.recordCount) });
  }
  if (input.notes?.length) {
    return {
      kind: "paragraphs",
      id: "technical",
      title: FINANCE_AUDIT_SECTION_TECHNICAL,
      paragraphs: input.notes,
    };
  }
  return {
    kind: "list",
    id: "technical",
    title: FINANCE_AUDIT_SECTION_TECHNICAL,
    items,
  };
}

export function buildFinanceExecutiveReportAuditSections(input: {
  endpoint: string;
  generatedAt: string | null | undefined;
  appliedFilterItems: FinanceDataAuditListItem[];
  warnings?: string[];
}): FinanceDataAuditSection[] {
  const sections: FinanceDataAuditSection[] = [
    {
      kind: "list",
      id: "sources",
      title: FINANCE_AUDIT_SECTION_SOURCES,
      items: [
        { label: "Relatório Presidencial", value: "Consolidação das abas Financeiro" },
      ],
    },
    {
      kind: "list",
      id: "sync",
      title: FINANCE_AUDIT_SECTION_SYNC,
      items: [
        {
          label: "Gerado em",
          value: input.generatedAt ? formatFinanceDateTime(input.generatedAt) : "—",
        },
      ],
    },
    {
      kind: "list",
      id: "filters",
      title: FINANCE_AUDIT_SECTION_FILTERS,
      items: input.appliedFilterItems,
    },
    buildFinanceModuleTechnicalAuditSection({ endpoint: input.endpoint }),
  ];
  if (input.warnings?.length) {
    sections.push({
      kind: "status",
      id: "warnings",
      title: "Observações",
      items: input.warnings.map((text) => ({ text })),
    });
  }
  return sections;
}
