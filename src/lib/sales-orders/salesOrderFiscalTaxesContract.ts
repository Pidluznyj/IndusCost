/**
 * TRIB-05 — Contrato estável da aba Tributos (API do detalhe do Pedido).
 *
 * Status:
 * - available — há NF válida com composição documental utilizável
 * - unavailable — nenhuma NF válida localizada (não é erro 500)
 * - partial — há NF(s), mas parte dos campos fiscais falta
 * - error — falha técnica real ao montar o payload
 */

import { NFE_FISCAL_PARSER_VERSION } from "@/src/lib/nfeFiscalXmlParser.js";
import {
  emptySalesOrderFiscalSettlementsBlock,
  type SalesOrderFiscalNfeDto,
  type SalesOrderFiscalNfeLinkOriginDto,
  type SalesOrderFiscalTaxesPayload,
  type SalesOrderFiscalTaxesStatus,
} from "./salesOrderFiscalTaxesClient.js";

export type ResolveSalesOrderFiscalTaxesStatusInput = {
  validNfeCount: number;
  cancelledNfeCount?: number;
  compositionIncomplete?: boolean;
  validNfeSources?: ReadonlyArray<SalesOrderFiscalNfeDto["source"]>;
};

export type ResolvedSalesOrderFiscalTaxesStatus = {
  status: Exclude<SalesOrderFiscalTaxesStatus, "error">;
  statusReason: string | null;
  warnings: string[];
};

/**
 * Resolve status documental a partir do payload já montado.
 * Campo tributário individual ausente → partial/warning, nunca “vazio”.
 */
export function resolveSalesOrderFiscalTaxesStatus(
  input: ResolveSalesOrderFiscalTaxesStatusInput
): ResolvedSalesOrderFiscalTaxesStatus {
  const warnings: string[] = [];
  const validCount = Math.max(0, Math.trunc(input.validNfeCount));

  if (validCount === 0) {
    return {
      status: "unavailable",
      statusReason:
        (input.cancelledNfeCount ?? 0) > 0
          ? "Nenhuma NF-e válida para totais; há NF cancelada apenas para auditoria."
          : "Nenhuma NF-e válida vinculada a este pedido.",
      warnings,
    };
  }

  const sources = input.validNfeSources ?? [];
  const hasMissingSource = sources.some((s) => s === "MISSING");
  const hasHeaderDiff = sources.some((s) => s === "HEADER_DIFF");
  const incomplete = Boolean(input.compositionIncomplete);

  if (incomplete || hasMissingSource || hasHeaderDiff) {
    if (incomplete) {
      warnings.push("Composição fiscal incompleta em uma ou mais NF-es válidas.");
    }
    if (hasMissingSource) {
      warnings.push("Resumo fiscal oficial ausente para parte das NF-es (MISSING).");
    }
    if (hasHeaderDiff) {
      warnings.push(
        "Parte das NF-es usa fallback de cabeçalho (HEADER_DIFF), sem tipagem completa."
      );
    }
    return {
      status: "partial",
      statusReason:
        "Existem NF-es válidas, mas parte dos campos fiscais documentais não está disponível.",
      warnings,
    };
  }

  return {
    status: "available",
    statusReason: null,
    warnings,
  };
}

export function buildSalesOrderFiscalNfeLinkOrigins(
  nfes: ReadonlyArray<{
    nfeExternalId: number;
    numero?: string | null;
    linkOrigin?: string | null;
    linkOrigins?: readonly string[] | null;
  }>
): SalesOrderFiscalNfeLinkOriginDto[] {
  const byId = new Map<number, SalesOrderFiscalNfeLinkOriginDto>();
  for (const nfe of nfes) {
    if (!Number.isFinite(nfe.nfeExternalId)) continue;
    const origins = [
      ...new Set(
        [
          ...(nfe.linkOrigins ?? []),
          nfe.linkOrigin ?? null,
        ].filter((o): o is string => Boolean(o && String(o).trim()))
      ),
    ];
    const existing = byId.get(nfe.nfeExternalId);
    if (!existing) {
      byId.set(nfe.nfeExternalId, {
        nfeExternalId: nfe.nfeExternalId,
        numero: nfe.numero ?? null,
        origins,
        primaryOrigin: origins[0] ?? null,
      });
      continue;
    }
    const merged = [...new Set([...existing.origins, ...origins])];
    byId.set(nfe.nfeExternalId, {
      ...existing,
      numero: existing.numero ?? nfe.numero ?? null,
      origins: merged,
      primaryOrigin: merged[0] ?? existing.primaryOrigin,
    });
  }
  return [...byId.values()].sort((a, b) => a.nfeExternalId - b.nfeExternalId);
}

/** Payload de erro técnico — HTTP do detalhe permanece 200 quando o pedido carrega. */
export function buildSalesOrderFiscalTaxesErrorPayload(
  reason: string,
  options?: { orderActiveValue?: number }
): SalesOrderFiscalTaxesPayload {
  const orderActiveValue = options?.orderActiveValue ?? 0;
  return {
    status: "error",
    statusReason: reason,
    warnings: [reason],
    linkOrigins: [],
    summary: {
      orderActiveValue,
      productsValue: 0,
      discountsValue: 0,
      freightValue: 0,
      insuranceValue: 0,
      otherExpensesValue: 0,
      nfeValidTotal: 0,
      amountToInvoice: orderActiveValue,
      financialBalance: null,
      financialBalanceLabel: "Sem CR gerado",
      validNfeCount: 0,
      cancelledNfeCount: 0,
      compositionIncomplete: true,
      compositionIncompleteReason: reason,
      sourceLabel: "XML NF-e",
      lastParsedAt: null,
      parserVersion: NFE_FISCAL_PARSER_VERSION,
    },
    highlightedTaxes: [],
    nfes: [],
    cancelledNfes: [],
    itemTaxLines: [],
    settlements: emptySalesOrderFiscalSettlementsBlock(new Date().toISOString()),
    technical: {
      source: "error",
      note: "Falha técnica ao montar tributos documentais — não confundir com ausência de NF.",
      doNotSumHeaderAndItem: true,
    },
  };
}

export function attachSalesOrderFiscalTaxesContract(
  payload: Omit<
    SalesOrderFiscalTaxesPayload,
    "status" | "statusReason" | "warnings" | "linkOrigins"
  > &
    Partial<
      Pick<
        SalesOrderFiscalTaxesPayload,
        "status" | "statusReason" | "warnings" | "linkOrigins"
      >
    >,
  options?: {
    linkOrigins?: SalesOrderFiscalNfeLinkOriginDto[];
    extraWarnings?: string[];
  }
): SalesOrderFiscalTaxesPayload {
  // Somente NF elegíveis a totais — NF ativa inelegível (billing=false) não força partial.
  const validNfeSources = payload.nfes
    .filter((n) => n.isValidForTotals)
    .map((n) => n.source);
  const resolved = resolveSalesOrderFiscalTaxesStatus({
    validNfeCount: payload.summary.validNfeCount,
    cancelledNfeCount: payload.summary.cancelledNfeCount,
    compositionIncomplete: payload.summary.compositionIncomplete,
    validNfeSources,
  });
  const warnings = [
    ...resolved.warnings,
    ...(options?.extraWarnings ?? []),
    ...(payload.warnings ?? []),
  ];
  return {
    ...payload,
    status: payload.status === "error" ? "error" : resolved.status,
    statusReason:
      payload.status === "error"
        ? payload.statusReason ?? resolved.statusReason
        : resolved.statusReason,
    warnings: [...new Set(warnings.filter(Boolean))],
    linkOrigins:
      options?.linkOrigins ??
      payload.linkOrigins ??
      buildSalesOrderFiscalNfeLinkOrigins([
        ...payload.nfes,
        ...payload.cancelledNfes,
      ]),
  };
}
