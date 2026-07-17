/**
 * TRIB-07 — contrato puro do auditor read-only de tributos por Pedido.
 * O módulo não acessa rede nem banco; recebe somente projeções limitadas.
 */

import {
  buildDocumentaryHeaderTaxes,
  consolidateDocumentaryHeaderTaxes,
  parseDocumentaryMoney,
} from "./salesOrderDocumentaryTaxes.js";
import { resolveSalesOrderFiscalTaxesStatus } from "./salesOrderFiscalTaxesContract.js";
import {
  extractOfficialItemNfeExternalId,
  resolveSalesOrderRelatedNfes,
  type SalesOrderRelatedNfeResolveResult,
} from "./salesOrderRelatedNfeResolver.js";

export const SALES_ORDER_TAXES_AUDIT_LOG_PREFIX = "[audit:sales-order:taxes]";
export const SALES_ORDER_TAXES_AUDIT_MAX_ROWS = 100;

export type SalesOrderTaxesAuditArgs = {
  order: string;
};

export function normalizeSalesOrderAuditCode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  const match = /^PD[-_]?(\d+)$/.exec(compact);
  if (!match) {
    throw new Error("--order inválido; use o formato PD02781.");
  }
  return `PD${match[1]}`;
}

export function salesOrderAuditCodeCandidates(order: string): string[] {
  const normalized = normalizeSalesOrderAuditCode(order);
  const digits = normalized.slice(2);
  return [...new Set([normalized, `PD ${digits}`])];
}

export function parseSalesOrderTaxesAuditArgs(
  argv: readonly string[]
): SalesOrderTaxesAuditArgs {
  let order: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--order=")) {
      if (order != null) throw new Error("--order deve ser informado uma única vez.");
      order = normalizeSalesOrderAuditCode(arg.slice("--order=".length));
      continue;
    }
    throw new Error(`argumento desconhecido: ${arg}`);
  }
  if (!order) throw new Error("--order é obrigatório; exemplo: --order=PD02781.");
  return { order };
}

export type SanitizedDatabaseTarget = {
  protocol: string;
  host: string;
  port: string | null;
  database: string;
  display: string;
};

export function sanitizeSalesOrderTaxesDatabaseUrl(
  raw: string | null | undefined
): SanitizedDatabaseTarget | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "(default)";
    const protocol = url.protocol.replace(/:$/, "") || "database";
    return {
      protocol,
      host: url.hostname,
      port: url.port || null,
      database,
      display: `${protocol}://${url.hostname}${url.port ? `:${url.port}` : ""}/${database}`,
    };
  } catch {
    return null;
  }
}

export function maskFiscalIdentifier(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.length <= 8) return `${text.slice(0, 2)}…${text.slice(-2)}`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

export type SalesOrderTaxesAuditInput = {
  requestedOrder: string;
  order: {
    id: string;
    orderCode: string;
    externalSalesOrderId: number | null;
    externalSalesOrderCode: string | null;
  } | null;
  links: Array<{
    id: string;
    salesOrderId: string;
    orderCode: string | null;
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeKey: string | null;
    nfeStatus: number | null;
    presentInLastPayload: boolean;
  }>;
  o2cFacts: Array<{
    nfeExternalId: number | null;
    nfeNumber: string | null;
    nfeKey: string | null;
    stockDocumentExternalId: number | null;
    stockDocumentIdNfe: number | null;
    stockDocumentType: string | null;
    stockDocumentDate: Date | string | null;
    salesOrderItemId: string | null;
    nfeItemMatchedOrderItem: boolean;
  }>;
  stockDocuments: Array<{
    id: string;
    externalId: number;
    idNfe: number | null;
    tipoDocumentoEstoque: string | null;
    dataDocumento: Date | string | null;
  }>;
  items: Array<{ id: string; nomusRawItem: unknown }>;
  foreignLinks: Array<{
    salesOrderId: string;
    orderCode: string | null;
    nfeExternalId: number;
  }>;
  nfes: Array<{
    id: string;
    externalId: number;
    numero: string | null;
    serie: string | null;
    chave: string | null;
    status: number | null;
    fiscalSummary: {
      source: string;
      parserVersion: string;
      parsedAt: Date | string;
      isCancelled: boolean;
      finalidade: number | null;
      vProd: unknown;
      vDesc: unknown;
      vFrete: unknown;
      vSeg: unknown;
      vOutro: unknown;
      vII: unknown;
      vIPI: unknown;
      vIPIDevol: unknown;
      vBC: unknown;
      vICMS: unknown;
      vICMSDeson: unknown;
      vBCST: unknown;
      vST: unknown;
      vFCP: unknown;
      vFCPST: unknown;
      vFCPSTRet: unknown;
      vPIS: unknown;
      vCOFINS: unknown;
      vISS: unknown;
      vTotTrib: unknown;
      vNF: unknown;
      highlightedResidual: unknown;
      qualityAlert: string | null;
      taxLines: Array<{
        taxType: string;
        scope: string;
        amount: unknown;
        baseAmount: unknown;
        rate: unknown;
      }>;
    } | null;
  }>;
};

export type SalesOrderTaxesAuditReport = {
  audit: "TRIB-07";
  mode: "READ_ONLY";
  requestedOrder: string;
  orderFound: boolean;
  order: SalesOrderTaxesAuditInput["order"];
  status: "available" | "unavailable" | "partial";
  exactUnavailableReason: string | null;
  counts: {
    salesOrderNfeLinks: number;
    outputDocuments: number;
    sourceHitsBeforeDedupe: number;
    uniqueNfes: number;
    duplicatesEliminated: number;
    validNfes: number;
    cancelledNfes: number;
    pendingLinks: number;
    conflicts: number;
  };
  salesOrderNfeLinks: Array<{
    id: string;
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeKeyMasked: string | null;
    nfeStatus: number | null;
    presentInLastPayload: boolean;
  }>;
  outputDocuments: SalesOrderTaxesAuditInput["stockDocuments"];
  nfesBySource: Record<string, number[]>;
  nfes: Array<{
    externalId: number;
    numero: string | null;
    serie: string | null;
    chaveMasked: string | null;
    status: number | null;
    isCancelled: boolean;
    includeInTaxTotals: boolean;
    origins: string[];
    fiscalSource: string;
    fieldsAvailable: string[];
    fieldsMissing: string[];
    headerTaxes: Array<{
      taxType: string;
      label: string;
      amount: number;
      baseAmount?: number | null;
    }>;
    qualityAlert: string | null;
  }>;
  consolidatedTaxes: Array<{
    taxType: string;
    label: string;
    amount: number;
    baseAmount?: number | null;
  }>;
  pendingLinks: string[];
  conflicts: string[];
  duplicateEvidence: Array<{
    nfeExternalId: number;
    sourceHits: number;
    origins: string[];
  }>;
  guarantees: {
    databaseWrites: false;
    nomusCalls: false;
    sensitivePayloadsIncluded: false;
    maxRowsPerQuery: number;
  };
};

const FISCAL_FIELDS = [
  "vProd",
  "vDesc",
  "vFrete",
  "vSeg",
  "vOutro",
  "vII",
  "vIPI",
  "vIPIDevol",
  "vBC",
  "vICMS",
  "vICMSDeson",
  "vBCST",
  "vST",
  "vFCP",
  "vFCPST",
  "vFCPSTRet",
  "vPIS",
  "vCOFINS",
  "vISS",
  "vTotTrib",
  "vNF",
] as const;

function buildResolver(input: SalesOrderTaxesAuditInput): SalesOrderRelatedNfeResolveResult {
  if (!input.order) {
    return resolveSalesOrderRelatedNfes({ salesOrderId: "ORDER_NOT_FOUND" });
  }
  const itemRefs = input.items
    .map((item) => ({
      salesOrderItemId: item.id,
      nfeExternalId: extractOfficialItemNfeExternalId(item.nomusRawItem),
    }))
    .filter(
      (row): row is { salesOrderItemId: string; nfeExternalId: number } =>
        row.nfeExternalId != null
    );
  return resolveSalesOrderRelatedNfes({
    salesOrderId: input.order.id,
    links: input.links.map((link) => ({
      ...link,
      linkId: link.id,
    })),
    o2cFacts: input.o2cFacts,
    stockDocuments: input.stockDocuments.map((doc) => ({
      stockDocumentExternalId: doc.externalId,
      idNfe: doc.idNfe,
    })),
    itemRefs,
    foreignLinks: input.foreignLinks,
    nfeStatusHints: input.nfes.map((nfe) => ({
      nfeExternalId: nfe.externalId,
      status: nfe.status,
      isCanceled: nfe.fiscalSummary?.isCancelled ?? null,
    })),
  });
}

export function buildSalesOrderTaxesAuditReport(
  input: SalesOrderTaxesAuditInput
): SalesOrderTaxesAuditReport {
  const resolved = buildResolver(input);
  const nfeById = new Map(input.nfes.map((nfe) => [nfe.externalId, nfe]));
  const sourceHitsBeforeDedupe = resolved.nfes.reduce(
    (sum, nfe) => sum + nfe.sources.length,
    0
  );
  const duplicateEvidence = resolved.nfes
    .filter((nfe) => nfe.sources.length > 1)
    .map((nfe) => ({
      nfeExternalId: nfe.nfeExternalId,
      sourceHits: nfe.sources.length,
      origins: nfe.origins,
    }));

  const nfesBySource: Record<string, number[]> = {};
  for (const nfe of resolved.nfes) {
    for (const origin of nfe.origins) {
      nfesBySource[origin] ??= [];
      nfesBySource[origin]!.push(nfe.nfeExternalId);
    }
  }

  const pendingLinks: string[] = [];
  for (const link of input.links) {
    if (!link.presentInLastPayload) {
      pendingLinks.push(
        `SalesOrderNfeLink ${link.id}: NF ${link.nfeExternalId} ausente do último payload persistido.`
      );
    }
    if (!nfeById.has(link.nfeExternalId)) {
      pendingLinks.push(
        `SalesOrderNfeLink ${link.id}: NF ${link.nfeExternalId} não localizada em NomusNfe local.`
      );
    }
  }
  for (const nfe of resolved.nfes) {
    if (!nfeById.has(nfe.nfeExternalId)) {
      pendingLinks.push(
        `NF ${nfe.nfeExternalId} encontrada por ${nfe.origins.join(", ")}, mas sem registro NomusNfe local.`
      );
    }
  }

  const conflicts = resolved.nfes
    .filter((nfe) => nfe.conflict)
    .map((nfe) => nfe.conflict!.message);

  const mappedNfes = resolved.nfes.map((resolvedNfe) => {
    const row = nfeById.get(resolvedNfe.nfeExternalId);
    const summary = row?.fiscalSummary ?? null;
    const fieldsAvailable = summary
      ? FISCAL_FIELDS.filter((field) => parseDocumentaryMoney(summary[field]) != null)
      : [];
    const fieldsMissing = summary
      ? FISCAL_FIELDS.filter((field) => parseDocumentaryMoney(summary[field]) == null)
      : [...FISCAL_FIELDS];
    const headerTaxes = summary
      ? buildDocumentaryHeaderTaxes({
          taxLines: summary.taxLines,
          summaryTotals: summary,
        })
      : [];
    return {
      externalId: resolvedNfe.nfeExternalId,
      numero: row?.numero ?? resolvedNfe.nfeNumber,
      serie: row?.serie ?? null,
      chaveMasked: maskFiscalIdentifier(row?.chave ?? resolvedNfe.nfeKey),
      status: row?.status ?? null,
      isCancelled: resolvedNfe.isCanceled,
      includeInTaxTotals: resolvedNfe.includeInTaxTotals,
      origins: resolvedNfe.origins,
      fiscalSource: summary?.source ?? "MISSING",
      fieldsAvailable,
      fieldsMissing,
      headerTaxes,
      qualityAlert: summary?.qualityAlert ?? null,
    };
  });

  const validNfes = mappedNfes.filter(
    (nfe) => nfe.includeInTaxTotals && nfeById.has(nfe.externalId)
  );
  const compositionIncomplete = validNfes.some(
    (nfe) =>
      nfe.fiscalSource === "MISSING" ||
      nfe.fiscalSource === "PARTIAL" ||
      Boolean(nfe.qualityAlert) ||
      (parseDocumentaryMoney(
        nfeById.get(nfe.externalId)?.fiscalSummary?.highlightedResidual
      ) ?? 0) > 0.05
  );
  const statusResolved = resolveSalesOrderFiscalTaxesStatus({
    validNfeCount: validNfes.length,
    cancelledNfeCount: mappedNfes.filter((nfe) => nfe.isCancelled).length,
    compositionIncomplete,
    validNfeSources: validNfes.map((nfe) =>
      nfe.fiscalSource === "MISSING" ? "MISSING" : "FISCAL_SUMMARY"
    ),
  });
  const consolidatedTaxes = consolidateDocumentaryHeaderTaxes(
    validNfes.map((nfe) => nfe.headerTaxes)
  );

  let exactUnavailableReason: string | null = statusResolved.statusReason;
  if (!input.order) {
    exactUnavailableReason = `Pedido ${input.requestedOrder} não localizado no banco local.`;
  } else if (resolved.nfes.length === 0) {
    exactUnavailableReason =
      "Nenhuma NF-e foi encontrada nas fontes SalesOrderNfeLink, Documento de Saída, Order-to-Cash ou referência oficial de item.";
  } else if (validNfes.length === 0) {
    exactUnavailableReason =
      "Foram encontradas NF-es, mas nenhuma é válida para os totais tributários (canceladas ou inelegíveis).";
  } else if (statusResolved.status === "partial") {
    exactUnavailableReason = null;
  }

  return {
    audit: "TRIB-07",
    mode: "READ_ONLY",
    requestedOrder: input.requestedOrder,
    orderFound: input.order != null,
    order: input.order,
    status: input.order ? statusResolved.status : "unavailable",
    exactUnavailableReason,
    counts: {
      salesOrderNfeLinks: input.links.length,
      outputDocuments: input.stockDocuments.length,
      sourceHitsBeforeDedupe,
      uniqueNfes: resolved.nfes.length,
      duplicatesEliminated: Math.max(0, sourceHitsBeforeDedupe - resolved.nfes.length),
      validNfes: validNfes.length,
      cancelledNfes: mappedNfes.filter((nfe) => nfe.isCancelled).length,
      pendingLinks: pendingLinks.length,
      conflicts: conflicts.length,
    },
    salesOrderNfeLinks: input.links.map((link) => ({
      id: link.id,
      nfeExternalId: link.nfeExternalId,
      nfeNumber: link.nfeNumber,
      nfeKeyMasked: maskFiscalIdentifier(link.nfeKey),
      nfeStatus: link.nfeStatus,
      presentInLastPayload: link.presentInLastPayload,
    })),
    outputDocuments: input.stockDocuments,
    nfesBySource,
    nfes: mappedNfes,
    consolidatedTaxes,
    pendingLinks,
    conflicts,
    duplicateEvidence,
    guarantees: {
      databaseWrites: false,
      nomusCalls: false,
      sensitivePayloadsIncluded: false,
      maxRowsPerQuery: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
    },
  };
}

export function resolveSalesOrderTaxesAuditExitCode(
  outcome: "ok" | "order_not_found" | "technical_error"
): number {
  return outcome === "technical_error" ? 1 : 0;
}

export const SALES_ORDER_TAXES_AUDIT_FORBIDDEN_PATTERNS = [
  /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /\$executeRaw(?:Unsafe)?\s*[(`]/,
  /\$queryRawUnsafe\s*\(/,
  /\$transaction\s*[(`]/,
  /\b(?:fetchNomus|nomusFetch|callNomus|syncNomus|NomusApiClient|nomusRequest)\b/,
] as const;

export function scanSalesOrderTaxesAuditSource(
  source: string
): Array<{ pattern: string; index: number }> {
  const withoutCommentsAndStrings = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, "\"\"");
  const violations: Array<{ pattern: string; index: number }> = [];
  for (const pattern of SALES_ORDER_TAXES_AUDIT_FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(withoutCommentsAndStrings);
    if (match) violations.push({ pattern: pattern.source, index: match.index });
  }
  return violations;
}
