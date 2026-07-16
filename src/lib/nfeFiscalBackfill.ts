/**
 * Backfill fiscal NF-e (T03) — tipos, CLI e classificação pura (sem Prisma).
 * Não altera XML / pedido / CR / comissão.
 */

import {
  NFE_FISCAL_PARSER_VERSION,
  NFE_FISCAL_SOURCE,
  NFE_TAX_SCOPE,
  parseNfeFiscalXml,
  type NfeFiscalParseResult,
} from "@/src/lib/nfeFiscalXmlParser.js";

export const NFE_FISCAL_BACKFILL_WATCH_ORDERS = [
  "PD 02457",
  "PD 02139",
  "PD 02072",
  "02457",
  "02139",
  "02072",
] as const;

export type NfeFiscalBackfillMode = "dry-run" | "apply" | "audit";

export type NfeFiscalBackfillRowClass =
  | "analyzable"
  | "missing_xml"
  | "invalid_xml"
  | "already_processed"
  | "stale_parser"
  | "needs_persist"
  | "cancelled";

export type NfeFiscalBackfillFilters = {
  limit: number | null;
  batchSize: number;
  force: boolean;
  onlyMissing: boolean;
  includeCancelled: boolean;
  fromDate: string | null;
  toDate: string | null;
  nfeNumber: string | null;
  externalId: number | null;
  orderCode: string | null;
  customerQuery: string | null;
  /** Resume: process only externalId > afterExternalId (asc) or continue cursor file. */
  afterExternalId: number | null;
};

export type NfeFiscalBackfillCli = NfeFiscalBackfillFilters & {
  mode: NfeFiscalBackfillMode;
  confirmApply: boolean;
  outBase: string | null;
  resumeFile: string | null;
  writeResume: boolean;
};

export type ExistingFiscalSummaryLite = {
  xmlHash: string | null;
  parserVersion: string;
  isCancelled: boolean;
  highlightedResidual: number | null;
  vNF: number | null;
  vIPI: number | null;
  headerTaxTypes: string[];
};

export type NfeFiscalBackfillCandidateInput = {
  id: string;
  externalId: number;
  numero: string | null;
  chave: string | null;
  status: number | null;
  xmlRaw: string | null;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
  xmlDestCnpjCpf: string | null;
  xmlVNF: number | null;
  valorLiquido: number | null;
  orderLinks: Array<{
    salesOrderId: string;
    orderCode: string | null;
    orderNetValue: number | null;
  }>;
  crCount: number;
  existingSummary: ExistingFiscalSummaryLite | null;
};

export type NfeFiscalBackfillRowResult = {
  nomusNfeId: string;
  externalId: number;
  numero: string | null;
  chave: string | null;
  status: number | null;
  isCancelled: boolean;
  classes: NfeFiscalBackfillRowClass[];
  actionable: boolean;
  action: "persist" | "skip" | "inspect";
  skipReason: string | null;
  xmlHash: string | null;
  parserVersion: string;
  source: string;
  qualityAlert: string | null;
  highlightedResidual: number | null;
  vProd: number | null;
  vNF: number | null;
  headerTaxTotals: Record<string, number>;
  orderCodes: string[];
  multiOrder: boolean;
  watchOrderHit: boolean;
  nfGreaterThanOrder: boolean;
  taxesWithoutComposition: boolean;
  cancelledWithCr: boolean;
  parse: NfeFiscalParseResult | null;
};

export type NfeFiscalBackfillAuditFinding = {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
  externalId: number | null;
  orderCodes: string[];
  meta?: Record<string, unknown>;
};

export type NfeFiscalBackfillPreviewReport = {
  generatedAt: string;
  mode: "dry-run" | "audit";
  parserVersion: string;
  filters: NfeFiscalBackfillFilters;
  inventory: {
    scanned: number;
    analyzable: number;
    missingXml: number;
    invalidXml: number;
    alreadyProcessed: number;
    staleParser: number;
    needsPersist: number;
    cancelled: number;
    actionable: number;
  };
  taxTotalsHeader: Record<string, number>;
  residualSum: number;
  residualCount: number;
  affectedOrderCodes: string[];
  watchOrders: Record<string, number>;
  findings: NfeFiscalBackfillAuditFinding[];
  rows: NfeFiscalBackfillRowResult[];
  risks: string[];
  rollback: string;
};

export type NfeFiscalBackfillApplyReport = {
  generatedAt: string;
  mode: "apply";
  parserVersion: string;
  filters: NfeFiscalBackfillFilters;
  attempted: number;
  persisted: number;
  skipped: number;
  errors: number;
  errorSamples: Array<{ externalId: number; message: string }>;
  persistedNomusNfeIds: string[];
  lastExternalId: number | null;
  risks: string[];
  rollback: string;
};

export type NfeFiscalBackfillResumeState = {
  version: 1;
  parserVersion: string;
  updatedAt: string;
  lastExternalId: number | null;
  processed: number;
  persisted: number;
  skipped: number;
  errors: number;
};

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function readArg(argv: string[], name: string): string | null {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3) || null;
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0) return argv[idx + 1] ?? null;
  return null;
}

function readInt(argv: string[], name: string): number | null {
  const raw = readArg(argv, name);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseNfeFiscalBackfillCli(argv: string[]): NfeFiscalBackfillCli {
  const wantApply = hasFlag(argv, "apply");
  const wantAudit = hasFlag(argv, "audit");
  const wantDry =
    hasFlag(argv, "dry-run") || hasFlag(argv, "preview") || (!wantApply && !wantAudit);

  if (wantApply && (hasFlag(argv, "dry-run") || hasFlag(argv, "preview"))) {
    throw new Error("Use apenas --dry-run/--preview ou --apply (não ambos).");
  }
  if (wantApply && wantAudit) {
    throw new Error("Use --audit separado de --apply.");
  }
  if (wantApply && !hasFlag(argv, "confirm-apply")) {
    throw new Error(
      "Apply exige --confirm-apply após revisar o dry-run. Não execute em produção sem aprovação."
    );
  }

  let mode: NfeFiscalBackfillMode = "dry-run";
  if (wantApply) mode = "apply";
  else if (wantAudit) mode = "audit";
  else if (wantDry) mode = "dry-run";

  return {
    mode,
    confirmApply: hasFlag(argv, "confirm-apply"),
    limit: readInt(argv, "limit"),
    batchSize: readInt(argv, "batch") ?? 50,
    force: hasFlag(argv, "force"),
    onlyMissing: hasFlag(argv, "only-missing"),
    includeCancelled: !hasFlag(argv, "exclude-cancelled"),
    fromDate: readArg(argv, "from"),
    toDate: readArg(argv, "to"),
    nfeNumber: readArg(argv, "nfe") ?? readArg(argv, "nfe-number"),
    externalId: readInt(argv, "external-id"),
    orderCode: readArg(argv, "order") ?? readArg(argv, "order-code"),
    customerQuery: readArg(argv, "customer") ?? readArg(argv, "dest"),
    afterExternalId: readInt(argv, "after-external-id"),
    outBase: readArg(argv, "out"),
    resumeFile: readArg(argv, "resume") ?? readArg(argv, "resume-file"),
    writeResume: hasFlag(argv, "write-resume") || Boolean(readArg(argv, "resume")),
  };
}

export function normalizeOrderCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function isWatchOrderCode(code: string | null | undefined): boolean {
  const n = normalizeOrderCode(code);
  if (!n) return false;
  return NFE_FISCAL_BACKFILL_WATCH_ORDERS.some((w) => {
    const ww = normalizeOrderCode(w);
    return n === ww || n.endsWith(ww) || n.includes(ww.replace("PD ", ""));
  });
}

export function classifyNfeFiscalBackfillRow(
  input: NfeFiscalBackfillCandidateInput,
  opts: { force: boolean; onlyMissing: boolean }
): NfeFiscalBackfillRowResult {
  const isCancelled = input.status === 7;
  const classes: NfeFiscalBackfillRowClass[] = [];
  if (isCancelled) classes.push("cancelled");

  const orderCodes = input.orderLinks
    .map((l) => l.orderCode)
    .filter((c): c is string => Boolean(c?.trim()));
  const multiOrder = input.orderLinks.length > 1;
  const watchOrderHit = orderCodes.some(isWatchOrderCode);

  const maxOrderNet = input.orderLinks.reduce((m, l) => {
    const v = l.orderNetValue;
    return v != null && Number.isFinite(v) ? Math.max(m, v) : m;
  }, 0);
  const vnfHint = input.xmlVNF;
  const nfGreaterThanOrder =
    vnfHint != null && maxOrderNet > 0 && vnfHint > maxOrderNet + 0.009;

  const cancelledWithCr = isCancelled && input.crCount > 0;

  if (!input.xmlRaw?.trim()) {
    classes.push("missing_xml");
    return {
      nomusNfeId: input.id,
      externalId: input.externalId,
      numero: input.numero,
      chave: input.chave,
      status: input.status,
      isCancelled,
      classes,
      actionable: false,
      action: "skip",
      skipReason: "xml_ausente",
      xmlHash: null,
      parserVersion: NFE_FISCAL_PARSER_VERSION,
      source: NFE_FISCAL_SOURCE.MISSING,
      qualityAlert: "XML ausente",
      highlightedResidual: null,
      vProd: null,
      vNF: input.xmlVNF,
      headerTaxTotals: {},
      orderCodes,
      multiOrder,
      watchOrderHit,
      nfGreaterThanOrder,
      taxesWithoutComposition: false,
      cancelledWithCr,
      parse: null,
    };
  }

  const parse = parseNfeFiscalXml(input.xmlRaw);
  if (parse.source === NFE_FISCAL_SOURCE.MISSING) {
    classes.push("invalid_xml");
  } else if (parse.source === NFE_FISCAL_SOURCE.PARTIAL && parse.totals.vNF == null) {
    classes.push("invalid_xml");
  } else {
    classes.push("analyzable");
  }

  const headerTaxTotals: Record<string, number> = {};
  for (const line of parse.lines) {
    if (line.scope !== NFE_TAX_SCOPE.HEADER || line.amount == null) continue;
    headerTaxTotals[line.taxType] = (headerTaxTotals[line.taxType] ?? 0) + line.amount;
  }

  const residual = parse.highlightedResidual;
  const positiveTaxes = Object.values(headerTaxTotals).some((v) => v > 0.009);
  const taxesWithoutCompositionFinal =
    (residual != null && residual > 0.05 && !positiveTaxes) ||
    (input.xmlVNF != null &&
      input.valorLiquido != null &&
      input.xmlVNF - input.valorLiquido > 0.05 &&
      !positiveTaxes &&
      parse.source !== NFE_FISCAL_SOURCE.MISSING);

  const existing = input.existingSummary;
  let action: NfeFiscalBackfillRowResult["action"] = "persist";
  let skipReason: string | null = null;
  let actionable = true;

  if (classes.includes("missing_xml") || classes.includes("invalid_xml")) {
    if (parse.source === NFE_FISCAL_SOURCE.MISSING || !parse.xmlHash) {
      action = "skip";
      actionable = false;
      skipReason = classes.includes("missing_xml") ? "xml_ausente" : "xml_invalido";
    }
  }

  if (actionable && existing) {
    const sameHash =
      Boolean(parse.xmlHash) &&
      existing.xmlHash === parse.xmlHash &&
      existing.parserVersion === NFE_FISCAL_PARSER_VERSION;
    if (sameHash && !opts.force) {
      classes.push("already_processed");
      action = "skip";
      actionable = false;
      skipReason = "ja_processado_mesma_versao";
    } else if (existing.parserVersion !== NFE_FISCAL_PARSER_VERSION) {
      classes.push("stale_parser");
      action = "persist";
      actionable = true;
      skipReason = null;
    } else if (!sameHash) {
      classes.push("needs_persist");
    }
  } else if (actionable && !existing) {
    classes.push("needs_persist");
  }

  if (opts.onlyMissing && existing) {
    action = "skip";
    actionable = false;
    skipReason = "only_missing_ja_tem_summary";
  }

  if (classes.includes("invalid_xml") && parse.totals.vNF == null && parse.totals.vProd == null) {
    action = "inspect";
    actionable = false;
    skipReason = "xml_invalido";
  }

  return {
    nomusNfeId: input.id,
    externalId: input.externalId,
    numero: input.numero,
    chave: input.chave,
    status: input.status,
    isCancelled,
    classes: [...new Set(classes)],
    actionable,
    action,
    skipReason,
    xmlHash: parse.xmlHash,
    parserVersion: parse.parserVersion,
    source: parse.source,
    qualityAlert: parse.qualityAlert,
    highlightedResidual: residual,
    vProd: parse.totals.vProd,
    vNF: parse.totals.vNF ?? input.xmlVNF,
    headerTaxTotals,
    orderCodes,
    multiOrder,
    watchOrderHit,
    nfGreaterThanOrder,
    taxesWithoutComposition: taxesWithoutCompositionFinal,
    cancelledWithCr,
    parse,
  };
}

export function buildFindingsFromRows(
  rows: readonly NfeFiscalBackfillRowResult[],
  extras?: {
    duplicateChaves?: Array<{ chave: string; externalIds: number[] }>;
  }
): NfeFiscalBackfillAuditFinding[] {
  const findings: NfeFiscalBackfillAuditFinding[] = [];

  for (const row of rows) {
    if (row.watchOrderHit) {
      findings.push({
        code: "WATCH_ORDER",
        severity: "info",
        message: `NF vinculada a pedido monitorado (${row.orderCodes.join(", ")})`,
        externalId: row.externalId,
        orderCodes: row.orderCodes,
      });
    }
    if (row.nfGreaterThanOrder) {
      findings.push({
        code: "NF_GT_ORDER",
        severity: "warn",
        message: `vNF (${row.vNF}) maior que líquido do pedido vinculado`,
        externalId: row.externalId,
        orderCodes: row.orderCodes,
        meta: { vNF: row.vNF },
      });
    }
    if (row.taxesWithoutComposition) {
      findings.push({
        code: "TAX_NO_COMPOSITION",
        severity: "warn",
        message: "Diferença vNF−produtos sem composição de tributos no XML/header",
        externalId: row.externalId,
        orderCodes: row.orderCodes,
        meta: { residual: row.highlightedResidual, headerTaxTotals: row.headerTaxTotals },
      });
    }
    if (row.multiOrder) {
      findings.push({
        code: "NF_MULTI_ORDER",
        severity: "warn",
        message: `NF vinculada a ${row.orderCodes.length || "vários"} pedidos`,
        externalId: row.externalId,
        orderCodes: row.orderCodes,
      });
    }
    if (row.cancelledWithCr) {
      findings.push({
        code: "CANCELLED_WITH_CR",
        severity: "error",
        message: "Nota cancelada com CR (sourceInvoiceId) associado",
        externalId: row.externalId,
        orderCodes: row.orderCodes,
      });
    }
    if (row.classes.includes("missing_xml")) {
      findings.push({
        code: "MISSING_XML",
        severity: "warn",
        message: "NF sem xmlRaw",
        externalId: row.externalId,
        orderCodes: row.orderCodes,
      });
    }
  }

  for (const dup of extras?.duplicateChaves ?? []) {
    findings.push({
      code: "DUPLICATE_CHAVE",
      severity: "error",
      message: `Chave NF duplicada em externalIds=${dup.externalIds.join(",")}`,
      externalId: dup.externalIds[0] ?? null,
      orderCodes: [],
      meta: { chave: dup.chave, externalIds: dup.externalIds },
    });
  }

  return findings;
}

export function summarizeBackfillRows(
  rows: readonly NfeFiscalBackfillRowResult[]
): NfeFiscalBackfillPreviewReport["inventory"] {
  const inv = {
    scanned: rows.length,
    analyzable: 0,
    missingXml: 0,
    invalidXml: 0,
    alreadyProcessed: 0,
    staleParser: 0,
    needsPersist: 0,
    cancelled: 0,
    actionable: 0,
  };
  for (const r of rows) {
    if (r.classes.includes("analyzable")) inv.analyzable += 1;
    if (r.classes.includes("missing_xml")) inv.missingXml += 1;
    if (r.classes.includes("invalid_xml")) inv.invalidXml += 1;
    if (r.classes.includes("already_processed")) inv.alreadyProcessed += 1;
    if (r.classes.includes("stale_parser")) inv.staleParser += 1;
    if (r.classes.includes("needs_persist")) inv.needsPersist += 1;
    if (r.classes.includes("cancelled")) inv.cancelled += 1;
    if (r.actionable) inv.actionable += 1;
  }
  return inv;
}

export function aggregateHeaderTaxTotals(
  rows: readonly NfeFiscalBackfillRowResult[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.headerTaxTotals)) {
      out[k] = Number(((out[k] ?? 0) + v).toFixed(2));
    }
  }
  return out;
}

export const NFE_FISCAL_BACKFILL_CSV_HEADER = [
  "externalId",
  "numero",
  "chave",
  "status",
  "classes",
  "action",
  "skipReason",
  "vNF",
  "vProd",
  "residual",
  "headerTaxes",
  "orderCodes",
  "watchOrder",
  "nfGtOrder",
  "taxNoComposition",
  "cancelledWithCr",
  "xmlHash",
] as const;

export function rowToCsvCells(row: NfeFiscalBackfillRowResult): string[] {
  return [
    String(row.externalId),
    row.numero ?? "",
    row.chave ?? "",
    row.status == null ? "" : String(row.status),
    row.classes.join("|"),
    row.action,
    row.skipReason ?? "",
    row.vNF == null ? "" : String(row.vNF),
    row.vProd == null ? "" : String(row.vProd),
    row.highlightedResidual == null ? "" : String(row.highlightedResidual),
    JSON.stringify(row.headerTaxTotals),
    row.orderCodes.join("|"),
    row.watchOrderHit ? "1" : "0",
    row.nfGreaterThanOrder ? "1" : "0",
    row.taxesWithoutComposition ? "1" : "0",
    row.cancelledWithCr ? "1" : "0",
    row.xmlHash ?? "",
  ];
}

export function rowsToCsv(rows: readonly NfeFiscalBackfillRowResult[]): string {
  const lines = [
    NFE_FISCAL_BACKFILL_CSV_HEADER.join(","),
    ...rows.map((r) =>
      rowToCsvCells(r)
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export const NFE_FISCAL_BACKFILL_RISKS = [
  "Apply só grava NomusNfeFiscalSummary/TaxLine — não altera xmlRaw, SalesOrder, CR ou comissão.",
  "Não executar --apply em produção sem dry-run revisado e --confirm-apply.",
  "HEADER e ITEM não devem ser somados juntos nos KPIs.",
  "highlightedResidual não é saldo financeiro.",
] as const;

export const NFE_FISCAL_BACKFILL_ROLLBACK =
  "Rollback: DELETE FROM \"NomusNfeFiscalSummary\" WHERE \"nomusNfeId\" IN (...ids do relatório apply...); " +
  "TaxLine cascateia. xmlRaw e demais entidades permanecem intactos.";

export function emptyResumeState(): NfeFiscalBackfillResumeState {
  return {
    version: 1,
    parserVersion: NFE_FISCAL_PARSER_VERSION,
    updatedAt: new Date().toISOString(),
    lastExternalId: null,
    processed: 0,
    persisted: 0,
    skipped: 0,
    errors: 0,
  };
}

export function mergeResumeProgress(
  prev: NfeFiscalBackfillResumeState,
  delta: {
    lastExternalId: number | null;
    processed: number;
    persisted: number;
    skipped: number;
    errors: number;
  }
): NfeFiscalBackfillResumeState {
  return {
    version: 1,
    parserVersion: NFE_FISCAL_PARSER_VERSION,
    updatedAt: new Date().toISOString(),
    lastExternalId: delta.lastExternalId ?? prev.lastExternalId,
    processed: prev.processed + delta.processed,
    persisted: prev.persisted + delta.persisted,
    skipped: prev.skipped + delta.skipped,
    errors: prev.errors + delta.errors,
  };
}
