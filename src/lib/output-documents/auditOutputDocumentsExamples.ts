/**
 * Exemplos parametrizados do auditor (DS-02.7): Documento / Pedido / NF-e.
 * Funções puras — fixtures e estratégias de busca. Não acessa banco.
 * Não inventa resultados: ausência → found=false.
 */

import {
  maskSensitiveIdentifier,
  sanitizeExampleValue,
} from "./auditOutputDocumentsRawJson.js";
import { NOMUS_NFE_CANCELLED_STATUS } from "./auditOutputDocumentsLinks.js";
import {
  classifyNfeVsReceivablesSum,
  toMoneyCents,
} from "./auditOutputDocumentsFinancial.js";

export type ExampleLookupStrategy = {
  strategy: string;
  key: string;
  attempted: boolean;
  matched: boolean;
  bound?: string;
  note?: string;
};

export type ExampleLookupResult<T> = {
  found: boolean;
  query: Record<string, string | number | null>;
  strategies: ExampleLookupStrategy[];
  data: T | null;
  notes: string[];
};

export type ExampleDocumentItem = {
  externalItemId: number | null;
  externalProductId: number | null;
  quantity: number | null;
  unitValueCents: number | null;
  estimatedTotalValueCents: number | null;
};

export type ExampleReceivableSummary = {
  externalId: number;
  amountReceivableCents: number;
  amountReceivedCents: number;
  balanceReceivableCents: number;
  dueDate: string | null;
  settlementDate: string | null;
};

export type ExampleAllocationSummary = {
  orderCode: string | null;
  allocatedValueByDocumentPriceCents: number | null;
  allocatedValueByOrderPriceCents: number | null;
  source: "order_to_cash_fact";
};

export type OutputDocumentExample = {
  header: {
    externalId: number;
    idNfe: number | null;
    tipoDocumentoEstoque: string | null;
    dataDocumento: string | null;
    syncedAt: string | null;
  };
  items: ExampleDocumentItem[];
  company: Record<string, string> | null;
  customer: Record<string, string> | null;
  status: {
    tipoDocumentoEstoque: string | null;
    notes: string[];
  };
  values: {
    itemCount: number;
    itemsTotalCents: number;
  };
  nfe: {
    idNfe: number | null;
    localExternalId: number | null;
    localStatus: number | null;
    cancelled: boolean | null;
  };
  orders: Array<{
    orderCode: string | null;
    salesOrderId: string | null;
    source: string;
  }>;
  allocations: ExampleAllocationSummary[];
  accountsReceivable: ExampleReceivableSummary[];
  paymentTerms: {
    paymentTerms: string | null;
    paymentMethod: string | null;
    rawJsonCandidates: Array<{ key: string; sanitizedValue: string }>;
  };
  relevantRawJson: Array<{ key: string; sanitizedValue: string }>;
};

export type SalesOrderExample = {
  header: {
    id: string;
    orderCode: string;
    externalSalesOrderId: number | null;
    externalSalesOrderCode: string | null;
    status: string | null;
    issueDate: string | null;
    companyIssuer: string | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
    totalNetValueCents: number | null;
    totalGrossValueCents: number | null;
  };
  customer: {
    id: string | null;
    companyName: string | null;
    taxIdMasked: string | null;
  } | null;
  items: Array<{
    skuSnapshot: string | null;
    productNameSnapshot: string | null;
    quantity: number | null;
    negotiatedPriceCents: number | null;
    totalNetValueCents: number | null;
  }>;
  nfes: Array<{
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeStatus: number | null;
    source: "sales_order_nfe_link";
  }>;
  documents: Array<{
    externalId: number;
    idNfe: number | null;
    source: string;
  }>;
  allocations: ExampleAllocationSummary[];
  accountsReceivable: ExampleReceivableSummary[];
  originalForecast: {
    totalNetValueCents: number | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
    notes: string[];
  };
  linkSources: string[];
};

export type NfeExample = {
  header: {
    externalId: number;
    chaveMasked: string | null;
    numero: string | null;
    serie: string | null;
  };
  status: {
    status: number | null;
    cancelled: boolean;
    billingClassification: string | null;
    isFiscalBilling: boolean | null;
    isMarketSale: boolean | null;
  };
  dates: {
    dataProcessamento: string | null;
    xmlDhEmi: string | null;
    syncedAt: string | null;
  };
  values: {
    xmlVProdCents: number | null;
    xmlVDescCents: number | null;
    xmlVNFCents: number | null;
    valorLiquidoCents: number | null;
  };
  documents: Array<{ externalId: number; tipoDocumentoEstoque: string | null }>;
  orders: Array<{ orderCode: string | null; salesOrderId: string | null }>;
  accountsReceivable: ExampleReceivableSummary[];
  cancellation: {
    cancelled: boolean;
    justificativaCancelamento: string | null;
    hasXmlCancelamento: boolean;
  };
  divergences: Array<{
    kind: string;
    status: string;
    differenceCents: number | null;
    note: string;
  }>;
};

export type ExamplesSection = {
  outputDocument: ExampleLookupResult<OutputDocumentExample>;
  salesOrder: ExampleLookupResult<SalesOrderExample>;
  nfe: ExampleLookupResult<NfeExample>;
};

const RELEVANT_RAW_KEY_PATTERNS: RegExp[] = [
  /empresa|company|emitente/i,
  /cliente|destinat|customer|pessoa/i,
  /status|situacao|situação/i,
  /pagamento|parcela|venciment|condicao|condição|formaPag/i,
  /total|valor|vNF|vProd/i,
  /nfe|nota|idNfe/i,
  /pedido|order/i,
  /cancel/i,
];

const MAX_RELEVANT_RAW_KEYS = 24;

export function planDocumentLookupStrategies(
  documentRef: number
): ExampleLookupStrategy[] {
  return [
    {
      strategy: "NomusStockDocument.externalId",
      key: String(documentRef),
      attempted: false,
      matched: false,
      bound: "unique",
      note: "Chave oficial única do stage de Documento de Saída.",
    },
  ];
}

export function planSalesOrderLookupStrategies(
  orderRef: string
): ExampleLookupStrategy[] {
  const trimmed = orderRef.trim();
  const strategies: ExampleLookupStrategy[] = [
    {
      strategy: "SalesOrder.orderCode",
      key: trimmed,
      attempted: false,
      matched: false,
      bound: "unique",
      note: "Código comercial oficial do pedido.",
    },
    {
      strategy: "SalesOrder.externalSalesOrderCode",
      key: trimmed,
      attempted: false,
      matched: false,
      bound: "LIMIT 5",
      note: "Código externo Nomus, quando o visível não for orderCode.",
    },
  ];
  if (/^\d+$/.test(trimmed)) {
    strategies.push({
      strategy: "SalesOrder.externalSalesOrderId",
      key: trimmed,
      attempted: false,
      matched: false,
      bound: "LIMIT 5",
      note: "Somente quando a referência for numérica pura.",
    });
  }
  return strategies;
}

export function planNfeLookupStrategies(nfeRef: number): ExampleLookupStrategy[] {
  const key = String(nfeRef);
  return [
    {
      strategy: "NomusNfe.externalId",
      key,
      attempted: false,
      matched: false,
      bound: "unique",
      note: "ID Nomus da NF-e (preferencial).",
    },
    {
      strategy: "NomusNfe.numero",
      key,
      attempted: false,
      matched: false,
      bound: "LIMIT 5",
      note: "Número visível da NF quando distinto do externalId.",
    },
    {
      strategy: "SalesOrderNfeLink.nfeExternalId",
      key,
      attempted: false,
      matched: false,
      bound: "LIMIT 5",
      note: "Confirma vínculos Pedido↔NF sem varredura ilimitada.",
    },
  ];
}

export function markStrategy(
  strategies: ExampleLookupStrategy[],
  strategyName: string,
  matched: boolean
): ExampleLookupStrategy[] {
  return strategies.map((s) =>
    s.strategy === strategyName ? { ...s, attempted: true, matched } : s
  );
}

export function buildNotFoundExampleLookup<T>(input: {
  query: Record<string, string | number | null>;
  strategies: ExampleLookupStrategy[];
  notes?: string[];
}): ExampleLookupResult<T> {
  return {
    found: false,
    query: input.query,
    strategies: input.strategies,
    data: null,
    notes: [
      "Exemplo não encontrado nas chaves oficiais tentadas.",
      "Ausência não é erro técnico do auditor.",
      ...(input.notes ?? []),
    ],
  };
}

export function buildFoundExampleLookup<T>(input: {
  query: Record<string, string | number | null>;
  strategies: ExampleLookupStrategy[];
  data: T;
  notes?: string[];
}): ExampleLookupResult<T> {
  return {
    found: true,
    query: input.query,
    strategies: input.strategies,
    data: input.data,
    notes: input.notes ?? [],
  };
}

export function extractRelevantRawJsonEntries(
  raw: unknown,
  maxKeys: number = MAX_RELEVANT_RAW_KEYS
): Array<{ key: string; sanitizedValue: string }> {
  const entries: Array<{ key: string; sanitizedValue: string }> = [];
  walkRelevant(raw, "", entries, 0, 6);
  return entries.slice(0, Math.max(0, maxKeys));
}

function walkRelevant(
  value: unknown,
  path: string,
  out: Array<{ key: string; sanitizedValue: string }>,
  depth: number,
  maxDepth: number
): void {
  if (out.length >= MAX_RELEVANT_RAW_KEYS || depth > maxDepth) return;
  if (value == null) return;

  if (Array.isArray(value)) {
    if (path && isRelevantPath(path)) {
      out.push({ key: path, sanitizedValue: sanitizeExampleValue(value) });
    }
    const limit = Math.min(value.length, 5);
    for (let i = 0; i < limit; i += 1) {
      walkRelevant(
        value[i],
        path ? `${path}[${i}]` : `[${i}]`,
        out,
        depth + 1,
        maxDepth
      );
    }
    return;
  }

  if (typeof value === "object") {
    for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${k}` : k;
      if (isRelevantPath(next) && !isPlainObjectOrArray(child)) {
        out.push({ key: next, sanitizedValue: sanitizeExampleValue(child) });
      }
      if (isPlainObjectOrArray(child)) {
        walkRelevant(child, next, out, depth + 1, maxDepth);
      }
    }
  }
}

function isPlainObjectOrArray(value: unknown): boolean {
  return value != null && typeof value === "object";
}

function isRelevantPath(path: string): boolean {
  return RELEVANT_RAW_KEY_PATTERNS.some((re) => re.test(path));
}

export function pickCompanyFromRawJson(
  entries: Array<{ key: string; sanitizedValue: string }>
): Record<string, string> | null {
  const company = Object.fromEntries(
    entries
      .filter((e) => /empresa|company|emitente/i.test(e.key))
      .slice(0, 8)
      .map((e) => [e.key, e.sanitizedValue])
  );
  return Object.keys(company).length > 0 ? company : null;
}

export function pickCustomerFromRawJson(
  entries: Array<{ key: string; sanitizedValue: string }>
): Record<string, string> | null {
  const customer = Object.fromEntries(
    entries
      .filter((e) => /cliente|destinat|customer|pessoa/i.test(e.key))
      .slice(0, 8)
      .map((e) => [e.key, e.sanitizedValue])
  );
  return Object.keys(customer).length > 0 ? customer : null;
}

export function pickPaymentCandidatesFromRawJson(
  entries: Array<{ key: string; sanitizedValue: string }>
): Array<{ key: string; sanitizedValue: string }> {
  return entries
    .filter((e) =>
      /pagamento|parcela|venciment|condicao|condição|formaPag/i.test(e.key)
    )
    .slice(0, 12);
}

export function maskNfeChave(chave: string | null | undefined): string | null {
  if (!chave) return null;
  const text = String(chave).trim();
  if (!text) return null;
  if (text.length <= 8) return maskSensitiveIdentifier(text);
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

export function isNfeCancelledStatus(status: number | null | undefined): boolean {
  return status === NOMUS_NFE_CANCELLED_STATUS;
}

export function buildOutputDocumentExampleFromFixture(fixture: {
  externalId: number;
  idNfe?: number | null;
  tipoDocumentoEstoque?: string | null;
  dataDocumento?: string | null;
  syncedAt?: string | null;
  items?: Array<{
    externalItemId?: number | null;
    externalProductId?: number | null;
    quantity?: number | null;
    unitValue?: number | null;
    estimatedTotalValue?: number | null;
  }>;
  rawJson?: unknown;
  localNfe?: { externalId: number; status: number | null } | null;
  orders?: Array<{
    orderCode: string | null;
    salesOrderId: string | null;
    source: string;
  }>;
  allocations?: ExampleAllocationSummary[];
  accountsReceivable?: ExampleReceivableSummary[];
}): OutputDocumentExample {
  const items = (fixture.items ?? []).map((item) => ({
    externalItemId: item.externalItemId ?? null,
    externalProductId: item.externalProductId ?? null,
    quantity: item.quantity ?? null,
    unitValueCents: item.unitValue == null ? null : toMoneyCents(item.unitValue),
    estimatedTotalValueCents:
      item.estimatedTotalValue == null
        ? null
        : toMoneyCents(item.estimatedTotalValue),
  }));
  const itemsTotalCents = items.reduce(
    (s, i) => s + (i.estimatedTotalValueCents ?? 0),
    0
  );
  const relevantRawJson = extractRelevantRawJsonEntries(fixture.rawJson ?? null);
  const localStatus = fixture.localNfe?.status ?? null;

  return {
    header: {
      externalId: fixture.externalId,
      idNfe: fixture.idNfe ?? null,
      tipoDocumentoEstoque: fixture.tipoDocumentoEstoque ?? null,
      dataDocumento: fixture.dataDocumento ?? null,
      syncedAt: fixture.syncedAt ?? null,
    },
    items,
    company: pickCompanyFromRawJson(relevantRawJson),
    customer: pickCustomerFromRawJson(relevantRawJson),
    status: {
      tipoDocumentoEstoque: fixture.tipoDocumentoEstoque ?? null,
      notes: [],
    },
    values: { itemCount: items.length, itemsTotalCents },
    nfe: {
      idNfe: fixture.idNfe ?? null,
      localExternalId: fixture.localNfe?.externalId ?? null,
      localStatus,
      cancelled: localStatus == null ? null : isNfeCancelledStatus(localStatus),
    },
    orders: fixture.orders ?? [],
    allocations: fixture.allocations ?? [],
    accountsReceivable: fixture.accountsReceivable ?? [],
    paymentTerms: {
      paymentTerms: null,
      paymentMethod: null,
      rawJsonCandidates: pickPaymentCandidatesFromRawJson(relevantRawJson),
    },
    relevantRawJson,
  };
}

export function buildSalesOrderExampleFromFixture(fixture: {
  id: string;
  orderCode: string;
  externalSalesOrderId?: number | null;
  externalSalesOrderCode?: string | null;
  status?: string | null;
  issueDate?: string | null;
  companyIssuer?: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  totalNetValue?: number | null;
  totalGrossValue?: number | null;
  customer?: {
    id?: string | null;
    companyName?: string | null;
    taxId?: string | null;
  } | null;
  items?: Array<{
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    quantity?: number | null;
    negotiatedPrice?: number | null;
    totalNetValue?: number | null;
  }>;
  nfes?: Array<{
    nfeExternalId: number;
    nfeNumber?: string | null;
    nfeStatus?: number | null;
  }>;
  documents?: Array<{
    externalId: number;
    idNfe?: number | null;
    source: string;
  }>;
  allocations?: ExampleAllocationSummary[];
  accountsReceivable?: ExampleReceivableSummary[];
  linkSources?: string[];
}): SalesOrderExample {
  return {
    header: {
      id: fixture.id,
      orderCode: fixture.orderCode,
      externalSalesOrderId: fixture.externalSalesOrderId ?? null,
      externalSalesOrderCode: fixture.externalSalesOrderCode ?? null,
      status: fixture.status ?? null,
      issueDate: fixture.issueDate ?? null,
      companyIssuer: fixture.companyIssuer
        ? maskSensitiveIdentifier(fixture.companyIssuer)
        : null,
      paymentTerms: fixture.paymentTerms ?? null,
      paymentMethod: fixture.paymentMethod ?? null,
      totalNetValueCents:
        fixture.totalNetValue == null
          ? null
          : toMoneyCents(fixture.totalNetValue),
      totalGrossValueCents:
        fixture.totalGrossValue == null
          ? null
          : toMoneyCents(fixture.totalGrossValue),
    },
    customer: fixture.customer
      ? {
          id: fixture.customer.id ?? null,
          companyName: fixture.customer.companyName ?? null,
          taxIdMasked: fixture.customer.taxId
            ? maskSensitiveIdentifier(fixture.customer.taxId)
            : null,
        }
      : null,
    items: (fixture.items ?? []).map((item) => ({
      skuSnapshot: item.skuSnapshot ?? null,
      productNameSnapshot: item.productNameSnapshot ?? null,
      quantity: item.quantity ?? null,
      negotiatedPriceCents:
        item.negotiatedPrice == null
          ? null
          : toMoneyCents(item.negotiatedPrice),
      totalNetValueCents:
        item.totalNetValue == null ? null : toMoneyCents(item.totalNetValue),
    })),
    nfes: (fixture.nfes ?? []).map((n) => ({
      nfeExternalId: n.nfeExternalId,
      nfeNumber: n.nfeNumber ?? null,
      nfeStatus: n.nfeStatus ?? null,
      source: "sales_order_nfe_link" as const,
    })),
    documents: (fixture.documents ?? []).map((d) => ({
      externalId: d.externalId,
      idNfe: d.idNfe ?? null,
      source: d.source,
    })),
    allocations: fixture.allocations ?? [],
    accountsReceivable: fixture.accountsReceivable ?? [],
    originalForecast: {
      totalNetValueCents:
        fixture.totalNetValue == null
          ? null
          : toMoneyCents(fixture.totalNetValue),
      paymentTerms: fixture.paymentTerms ?? null,
      paymentMethod: fixture.paymentMethod ?? null,
      notes: [
        "Previsão original = totais/condição do Pedido (não é CR real).",
      ],
    },
    linkSources: fixture.linkSources ?? [],
  };
}

export function buildNfeExampleFromFixture(fixture: {
  externalId: number;
  chave?: string | null;
  numero?: string | null;
  serie?: string | null;
  status?: number | null;
  billingClassification?: string | null;
  isFiscalBilling?: boolean | null;
  isMarketSale?: boolean | null;
  dataProcessamento?: string | null;
  xmlDhEmi?: string | null;
  syncedAt?: string | null;
  xmlVProd?: number | null;
  xmlVDesc?: number | null;
  xmlVNF?: number | null;
  valorLiquido?: number | null;
  justificativaCancelamento?: string | null;
  hasXmlCancelamento?: boolean;
  documents?: Array<{
    externalId: number;
    tipoDocumentoEstoque?: string | null;
  }>;
  orders?: Array<{ orderCode: string | null; salesOrderId: string | null }>;
  accountsReceivable?: ExampleReceivableSummary[];
}): NfeExample {
  const cancelled = isNfeCancelledStatus(fixture.status);
  const xmlVNFCents =
    fixture.xmlVNF == null ? null : toMoneyCents(fixture.xmlVNF);
  const titlesSum = (fixture.accountsReceivable ?? []).reduce(
    (s, t) => s + t.amountReceivableCents,
    0
  );
  const nfeVsCr = classifyNfeVsReceivablesSum({
    nfeValueCents: xmlVNFCents ?? toMoneyCents(fixture.valorLiquido ?? 0),
    titlesAmountReceivableCents: titlesSum,
  });

  const divergences: NfeExample["divergences"] = [];
  if (nfeVsCr.status === "divergente" || nfeVsCr.status === "arredondamento") {
    divergences.push({
      kind: "nfe_vs_receivables_sum",
      status: nfeVsCr.status,
      differenceCents: nfeVsCr.differenceCents,
      note: nfeVsCr.reasons[0] ?? "Divergência NF × soma dos títulos.",
    });
  }

  return {
    header: {
      externalId: fixture.externalId,
      chaveMasked: maskNfeChave(fixture.chave),
      numero: fixture.numero ?? null,
      serie: fixture.serie ?? null,
    },
    status: {
      status: fixture.status ?? null,
      cancelled,
      billingClassification: fixture.billingClassification ?? null,
      isFiscalBilling: fixture.isFiscalBilling ?? null,
      isMarketSale: fixture.isMarketSale ?? null,
    },
    dates: {
      dataProcessamento: fixture.dataProcessamento ?? null,
      xmlDhEmi: fixture.xmlDhEmi ?? null,
      syncedAt: fixture.syncedAt ?? null,
    },
    values: {
      xmlVProdCents:
        fixture.xmlVProd == null ? null : toMoneyCents(fixture.xmlVProd),
      xmlVDescCents:
        fixture.xmlVDesc == null ? null : toMoneyCents(fixture.xmlVDesc),
      xmlVNFCents,
      valorLiquidoCents:
        fixture.valorLiquido == null
          ? null
          : toMoneyCents(fixture.valorLiquido),
    },
    documents: (fixture.documents ?? []).map((d) => ({
      externalId: d.externalId,
      tipoDocumentoEstoque: d.tipoDocumentoEstoque ?? null,
    })),
    orders: fixture.orders ?? [],
    accountsReceivable: fixture.accountsReceivable ?? [],
    cancellation: {
      cancelled,
      justificativaCancelamento: fixture.justificativaCancelamento
        ? sanitizeExampleValue(fixture.justificativaCancelamento)
        : null,
      hasXmlCancelamento: Boolean(fixture.hasXmlCancelamento),
    },
    divergences,
  };
}

export function buildEmptyExamplesSection(): ExamplesSection {
  return {
    outputDocument: buildNotFoundExampleLookup({
      query: { document: null },
      strategies: [],
      notes: ["Aguardando investigação parametrizada (DS-02.7)."],
    }),
    salesOrder: buildNotFoundExampleLookup({
      query: { order: null },
      strategies: [],
      notes: ["Aguardando investigação parametrizada (DS-02.7)."],
    }),
    nfe: buildNotFoundExampleLookup({
      query: { nfe: null },
      strategies: [],
      notes: ["Aguardando investigação parametrizada (DS-02.7)."],
    }),
  };
}
