/**
 * Parser fiscal NF-e v2 — totais ICMSTot + linhas HEADER/ITEM.
 * Não recalcula imposto por alíquota quando o XML já traz o valor oficial.
 * Não trata residual como saldo financeiro.
 */

import { createHash } from "node:crypto";

export const NFE_FISCAL_PARSER_VERSION = "nfe-xml-fiscal-v1";

export const NFE_TAX_SCOPE = {
  HEADER: "HEADER",
  ITEM: "ITEM",
} as const;

export type NfeTaxScope = (typeof NFE_TAX_SCOPE)[keyof typeof NFE_TAX_SCOPE];

export const NFE_FISCAL_SOURCE = {
  XML: "XML",
  MISSING: "MISSING",
  PARTIAL: "PARTIAL",
} as const;

export type NfeFiscalSource = (typeof NFE_FISCAL_SOURCE)[keyof typeof NFE_FISCAL_SOURCE];

/** Tipos estáveis; desconhecidos → OTHER + metadata. */
export const NFE_TAX_TYPES = [
  "ICMS",
  "ICMS_ST",
  "ICMS_DESON",
  "FCP",
  "FCP_ST",
  "FCP_ST_RET",
  "IPI",
  "IPI_DEVOL",
  "PIS",
  "COFINS",
  "II",
  "ISS",
  "IBS",
  "CBS",
  "IS",
  "OTHER",
] as const;

export type NfeTaxType = (typeof NFE_TAX_TYPES)[number] | string;

export type NfeFiscalTaxLineParsed = {
  lineKey: string;
  taxType: NfeTaxType;
  scope: NfeTaxScope;
  itemNumber: number | null;
  baseAmount: number | null;
  rate: number | null;
  amount: number | null;
  cst: string | null;
  csosn: string | null;
  cfop: string | null;
  ncm: string | null;
  metadata: Record<string, unknown> | null;
  source: NfeFiscalSource;
  sourcePath: string;
};

export type NfeFiscalTotalsParsed = {
  vProd: number | null;
  vDesc: number | null;
  vFrete: number | null;
  vSeg: number | null;
  vOutro: number | null;
  vII: number | null;
  vIPI: number | null;
  vIPIDevol: number | null;
  vBC: number | null;
  vICMS: number | null;
  vICMSDeson: number | null;
  vBCST: number | null;
  vST: number | null;
  vFCP: number | null;
  vFCPST: number | null;
  vFCPSTRet: number | null;
  vPIS: number | null;
  vCOFINS: number | null;
  vISS: number | null;
  vTotTrib: number | null;
  vNF: number | null;
};

export type NfeFiscalParseResult = {
  parserVersion: typeof NFE_FISCAL_PARSER_VERSION;
  source: NfeFiscalSource;
  xmlHash: string | null;
  parsedAt: Date;
  finalidade: number | null;
  tpNF: number | null;
  totals: NfeFiscalTotalsParsed;
  extensibleTotals: Record<string, number> | null;
  highlightedResidual: number | null;
  qualityAlert: string | null;
  lines: NfeFiscalTaxLineParsed[];
};

const ICMSTOT_AMOUNT_TAGS: Array<{ tag: string; taxType: NfeTaxType; field: keyof NfeFiscalTotalsParsed }> = [
  { tag: "vICMS", taxType: "ICMS", field: "vICMS" },
  { tag: "vICMSDeson", taxType: "ICMS_DESON", field: "vICMSDeson" },
  { tag: "vST", taxType: "ICMS_ST", field: "vST" },
  { tag: "vFCP", taxType: "FCP", field: "vFCP" },
  { tag: "vFCPST", taxType: "FCP_ST", field: "vFCPST" },
  { tag: "vFCPSTRet", taxType: "FCP_ST_RET", field: "vFCPSTRet" },
  { tag: "vIPI", taxType: "IPI", field: "vIPI" },
  { tag: "vIPIDevol", taxType: "IPI_DEVOL", field: "vIPIDevol" },
  { tag: "vPIS", taxType: "PIS", field: "vPIS" },
  { tag: "vCOFINS", taxType: "COFINS", field: "vCOFINS" },
  { tag: "vII", taxType: "II", field: "vII" },
];

const EXTENSIBLE_TOTAL_TAGS = ["vIBS", "vCBS", "vIS", "vIBSCBS"] as const;

function stripXmlNoise(xml: string): string {
  return xml
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sxmlns(:\w+)?="[^"]*"/gi, "")
    .replace(/(<\/?)[\w.-]+:/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i");
  const match = re.exec(block);
  if (!match) return null;
  const value = match[1]?.trim();
  return value || null;
}

function parseDecimal(value: string | null): number | null {
  if (value == null) return null;
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseIntLoose(value: string | null): number | null {
  if (value == null) return null;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function roundMoney2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function moneyOrNull(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return roundMoney2(n);
}

export function hashNfeXmlContent(xml: string | null | undefined): string | null {
  if (!xml || typeof xml !== "string" || !xml.trim()) return null;
  return createHash("sha256").update(xml).digest("hex");
}

function extractBlock(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const match = re.exec(xml);
  return match?.[1] ?? null;
}

function collectBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] != null) out.push(m[1]);
  }
  return out;
}

function readTotals(icmsTot: string | null, fallbackXml: string): NfeFiscalTotalsParsed {
  const src = icmsTot ?? fallbackXml;
  return {
    vProd: parseDecimal(extractTag(src, "vProd")),
    vDesc: parseDecimal(extractTag(src, "vDesc")),
    vFrete: parseDecimal(extractTag(src, "vFrete")),
    vSeg: parseDecimal(extractTag(src, "vSeg")),
    vOutro: parseDecimal(extractTag(src, "vOutro")),
    vII: parseDecimal(extractTag(src, "vII")),
    vIPI: parseDecimal(extractTag(src, "vIPI")),
    vIPIDevol: parseDecimal(extractTag(src, "vIPIDevol")),
    vBC: parseDecimal(extractTag(src, "vBC")),
    vICMS: parseDecimal(extractTag(src, "vICMS")),
    vICMSDeson: parseDecimal(extractTag(src, "vICMSDeson")),
    vBCST: parseDecimal(extractTag(src, "vBCST")),
    vST: parseDecimal(extractTag(src, "vST")),
    vFCP: parseDecimal(extractTag(src, "vFCP")),
    vFCPST: parseDecimal(extractTag(src, "vFCPST")),
    vFCPSTRet: parseDecimal(extractTag(src, "vFCPSTRet")),
    vPIS: parseDecimal(extractTag(src, "vPIS")),
    vCOFINS: parseDecimal(extractTag(src, "vCOFINS")),
    vISS: parseDecimal(extractTag(src, "vISS")),
    vTotTrib: parseDecimal(extractTag(src, "vTotTrib")),
    vNF: parseDecimal(extractTag(src, "vNF")),
  };
}

function readExtensibleTotals(icmsTot: string | null, xml: string): Record<string, number> | null {
  const sources = [icmsTot, extractBlock(xml, "IBSCBSTot"), extractBlock(xml, "ISTot"), xml].filter(
    Boolean
  ) as string[];
  const out: Record<string, number> = {};
  for (const tag of EXTENSIBLE_TOTAL_TAGS) {
    for (const src of sources) {
      const n = parseDecimal(extractTag(src, tag));
      if (n != null) {
        out[tag] = n;
        break;
      }
    }
  }
  // ISSQNTot
  const issqnTot = extractBlock(xml, "ISSQNTot");
  if (issqnTot) {
    const vISS = parseDecimal(extractTag(issqnTot, "vISS"));
    if (vISS != null) out.vISS_ISSQNTot = vISS;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Residual = vNF − produtos líquidos − frete/seguro/outro − soma dos tributos oficiais do header.
 * Nunca é saldo financeiro (CR/pedido).
 */
export function computeHighlightedResidual(totals: NfeFiscalTotalsParsed): number | null {
  if (totals.vNF == null || totals.vProd == null) return null;
  const productsNet = totals.vProd - (totals.vDesc ?? 0);
  const extras =
    (totals.vFrete ?? 0) + (totals.vSeg ?? 0) + (totals.vOutro ?? 0);
  const taxes =
    (totals.vII ?? 0) +
    (totals.vIPI ?? 0) +
    (totals.vIPIDevol ?? 0) +
    (totals.vICMS ?? 0) +
    (totals.vICMSDeson ?? 0) +
    (totals.vST ?? 0) +
    (totals.vFCP ?? 0) +
    (totals.vFCPST ?? 0) +
    (totals.vFCPSTRet ?? 0) +
    (totals.vPIS ?? 0) +
    (totals.vCOFINS ?? 0) +
    (totals.vISS ?? 0);
  return moneyOrNull(Math.max(0, totals.vNF - productsNet - extras - taxes));
}

function headerLine(
  taxType: NfeTaxType,
  amount: number | null,
  opts?: {
    baseAmount?: number | null;
    sourcePath?: string;
    metadata?: Record<string, unknown> | null;
  }
): NfeFiscalTaxLineParsed | null {
  if (amount == null) return null;
  return {
    lineKey: `H:${taxType}`,
    taxType,
    scope: NFE_TAX_SCOPE.HEADER,
    itemNumber: null,
    baseAmount: opts?.baseAmount ?? null,
    rate: null,
    amount: moneyOrNull(amount),
    cst: null,
    csosn: null,
    cfop: null,
    ncm: null,
    metadata: opts?.metadata ?? null,
    source: NFE_FISCAL_SOURCE.XML,
    sourcePath: opts?.sourcePath ?? `ICMSTot/${taxType}`,
  };
}

function buildHeaderLines(totals: NfeFiscalTotalsParsed, icmsTotPresent: boolean): NfeFiscalTaxLineParsed[] {
  if (!icmsTotPresent) return [];
  const lines: NfeFiscalTaxLineParsed[] = [];
  for (const row of ICMSTOT_AMOUNT_TAGS) {
    const amount = totals[row.field];
    if (typeof amount !== "number") continue;
    const base =
      row.taxType === "ICMS"
        ? totals.vBC
        : row.taxType === "ICMS_ST"
          ? totals.vBCST
          : null;
    const line = headerLine(row.taxType, amount, {
      baseAmount: base,
      sourcePath: `ICMSTot/${row.tag}`,
    });
    if (line) lines.push(line);
  }
  if (totals.vISS != null) {
    const line = headerLine("ISS", totals.vISS, { sourcePath: "ICMSTot|ISSQNTot/vISS" });
    if (line) lines.push(line);
  }
  return lines;
}

function findFirstChildGroup(impostoBlock: string, parentTag: string): { group: string; body: string } | null {
  const parent = extractBlock(impostoBlock, parentTag);
  if (!parent) return null;
  const childRe = /<([A-Za-z0-9]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  let fallback: { group: string; body: string } | null = null;
  while ((m = childRe.exec(parent)) !== null) {
    const name = m[1];
    const body = m[2] ?? "";
    if (!name || name.toLowerCase() === parentTag.toLowerCase()) continue;
    // Preferir grupos compostos (ICMS00, IPITrib, PISAliq…) em vez de folhas (cEnq, orig).
    const hasNested = /<[A-Za-z0-9]+[\s>]/.test(body);
    if (hasNested) return { group: name, body };
    if (!fallback) fallback = { group: name, body };
  }
  if (fallback) return fallback;
  return { group: parentTag, body: parent };
}

function parseItemTaxGroup(
  imposto: string,
  parentTag: string,
  taxType: NfeTaxType,
  amountTags: string[],
  itemNumber: number,
  cfop: string | null,
  ncm: string | null
): NfeFiscalTaxLineParsed | null {
  const found = findFirstChildGroup(imposto, parentTag);
  if (!found) return null;
  let amount: number | null = null;
  let amountTag: string | null = null;
  for (const tag of amountTags) {
    const n = parseDecimal(extractTag(found.body, tag));
    if (n != null) {
      amount = n;
      amountTag = tag;
      break;
    }
  }
  if (amount == null && amountTag == null) {
    // grupo presente sem valor — ignora linha vazia
    return null;
  }
  const base =
    parseDecimal(extractTag(found.body, "vBC")) ??
    parseDecimal(extractTag(found.body, "vBCST")) ??
    null;
  const rate =
    parseDecimal(extractTag(found.body, "pICMS")) ??
    parseDecimal(extractTag(found.body, "pICMSST")) ??
    parseDecimal(extractTag(found.body, "pIPI")) ??
    parseDecimal(extractTag(found.body, "pPIS")) ??
    parseDecimal(extractTag(found.body, "pCOFINS")) ??
    parseDecimal(extractTag(found.body, "pFCP")) ??
    null;
  const cst = extractTag(found.body, "CST");
  const csosn = extractTag(found.body, "CSOSN");
  return {
    lineKey: `I:${itemNumber}:${taxType}`,
    taxType,
    scope: NFE_TAX_SCOPE.ITEM,
    itemNumber,
    baseAmount: base,
    rate,
    amount: moneyOrNull(amount),
    cst,
    csosn,
    cfop,
    ncm,
    metadata: { group: found.group },
    source: NFE_FISCAL_SOURCE.XML,
    sourcePath: `det[${itemNumber}]/imposto/${parentTag}/${found.group}/${amountTag ?? "amount"}`,
  };
}

function parseDetItem(detBody: string, fallbackNItem: number): NfeFiscalTaxLineParsed[] {
  const nItem = parseIntLoose(extractTag(detBody, "nItem")) ?? fallbackNItem;
  const prod = extractBlock(detBody, "prod") ?? "";
  const cfop = extractTag(prod, "CFOP");
  const ncm = extractTag(prod, "NCM");
  const imposto = extractBlock(detBody, "imposto") ?? "";
  if (!imposto) return [];

  const lines: NfeFiscalTaxLineParsed[] = [];
  const push = (line: NfeFiscalTaxLineParsed | null) => {
    if (line) lines.push(line);
  };

  push(parseItemTaxGroup(imposto, "ICMS", "ICMS", ["vICMS"], nItem, cfop, ncm));
  // ST às vezes no mesmo grupo ICMS*
  const icmsGroup = findFirstChildGroup(imposto, "ICMS");
  if (icmsGroup) {
    const vST = parseDecimal(extractTag(icmsGroup.body, "vICMSST"));
    if (vST != null) {
      lines.push({
        lineKey: `I:${nItem}:ICMS_ST`,
        taxType: "ICMS_ST",
        scope: NFE_TAX_SCOPE.ITEM,
        itemNumber: nItem,
        baseAmount: parseDecimal(extractTag(icmsGroup.body, "vBCST")),
        rate: parseDecimal(extractTag(icmsGroup.body, "pICMSST")),
        amount: moneyOrNull(vST),
        cst: extractTag(icmsGroup.body, "CST"),
        csosn: extractTag(icmsGroup.body, "CSOSN"),
        cfop,
        ncm,
        metadata: { group: icmsGroup.group },
        source: NFE_FISCAL_SOURCE.XML,
        sourcePath: `det[${nItem}]/imposto/ICMS/${icmsGroup.group}/vICMSST`,
      });
    }
    const vFcp = parseDecimal(extractTag(icmsGroup.body, "vFCP"));
    if (vFcp != null) {
      lines.push({
        lineKey: `I:${nItem}:FCP`,
        taxType: "FCP",
        scope: NFE_TAX_SCOPE.ITEM,
        itemNumber: nItem,
        baseAmount: parseDecimal(extractTag(icmsGroup.body, "vBCFCP")),
        rate: parseDecimal(extractTag(icmsGroup.body, "pFCP")),
        amount: moneyOrNull(vFcp),
        cst: extractTag(icmsGroup.body, "CST"),
        csosn: extractTag(icmsGroup.body, "CSOSN"),
        cfop,
        ncm,
        metadata: { group: icmsGroup.group },
        source: NFE_FISCAL_SOURCE.XML,
        sourcePath: `det[${nItem}]/imposto/ICMS/${icmsGroup.group}/vFCP`,
      });
    }
    const vDeson = parseDecimal(extractTag(icmsGroup.body, "vICMSDeson"));
    if (vDeson != null) {
      lines.push({
        lineKey: `I:${nItem}:ICMS_DESON`,
        taxType: "ICMS_DESON",
        scope: NFE_TAX_SCOPE.ITEM,
        itemNumber: nItem,
        baseAmount: null,
        rate: null,
        amount: moneyOrNull(vDeson),
        cst: extractTag(icmsGroup.body, "CST"),
        csosn: extractTag(icmsGroup.body, "CSOSN"),
        cfop,
        ncm,
        metadata: { group: icmsGroup.group },
        source: NFE_FISCAL_SOURCE.XML,
        sourcePath: `det[${nItem}]/imposto/ICMS/${icmsGroup.group}/vICMSDeson`,
      });
    }
  }

  push(parseItemTaxGroup(imposto, "IPI", "IPI", ["vIPI"], nItem, cfop, ncm));
  push(parseItemTaxGroup(imposto, "PIS", "PIS", ["vPIS"], nItem, cfop, ncm));
  push(parseItemTaxGroup(imposto, "COFINS", "COFINS", ["vCOFINS"], nItem, cfop, ncm));
  push(parseItemTaxGroup(imposto, "II", "II", ["vII"], nItem, cfop, ncm));
  push(parseItemTaxGroup(imposto, "ISSQN", "ISS", ["vISSQN", "vISS"], nItem, cfop, ncm));

  // Reforma / desconhecidos sob imposto — captura tags v* não mapeadas como OTHER (limitado)
  const knownAmountTags = new Set([
    "vICMS",
    "vICMSST",
    "vICMSDeson",
    "vFCP",
    "vIPI",
    "vPIS",
    "vCOFINS",
    "vII",
    "vISSQN",
    "vISS",
    "vBC",
    "vBCST",
    "vBCFCP",
  ]);
  const unknownRe = /<(v[A-Za-z0-9]+)>([^<]*)<\/\1>/gi;
  let um: RegExpExecArray | null;
  const seenOther = new Set<string>();
  while ((um = unknownRe.exec(imposto)) !== null) {
    const tag = um[1];
    if (!tag || knownAmountTags.has(tag)) continue;
    if (!/^v(IBS|CBS|IS|IBSCBS)/i.test(tag)) continue;
    const amount = parseDecimal(um[2] ?? null);
    if (amount == null) continue;
    const taxType = tag.toUpperCase().startsWith("VIBS")
      ? "IBS"
      : tag.toUpperCase().startsWith("VCBS")
        ? "CBS"
        : tag.toUpperCase().startsWith("VIS")
          ? "IS"
          : "OTHER";
    const key = `I:${nItem}:${taxType}:${tag}`;
    if (seenOther.has(key)) continue;
    seenOther.add(key);
    lines.push({
      lineKey: taxType === "OTHER" ? `I:${nItem}:OTHER:${tag}` : `I:${nItem}:${taxType}`,
      taxType,
      scope: NFE_TAX_SCOPE.ITEM,
      itemNumber: nItem,
      baseAmount: null,
      rate: null,
      amount: moneyOrNull(amount),
      cst: null,
      csosn: null,
      cfop,
      ncm,
      metadata: { xmlTag: tag },
      source: NFE_FISCAL_SOURCE.XML,
      sourcePath: `det[${nItem}]/imposto/${tag}`,
    });
  }

  return lines;
}

export function parseNfeFiscalXml(xml: string | null | undefined): NfeFiscalParseResult {
  const parsedAt = new Date();
  const xmlHash = hashNfeXmlContent(xml);

  if (!xml || typeof xml !== "string" || !xml.trim()) {
    return {
      parserVersion: NFE_FISCAL_PARSER_VERSION,
      source: NFE_FISCAL_SOURCE.MISSING,
      xmlHash: null,
      parsedAt,
      finalidade: null,
      tpNF: null,
      totals: {
        vProd: null,
        vDesc: null,
        vFrete: null,
        vSeg: null,
        vOutro: null,
        vII: null,
        vIPI: null,
        vIPIDevol: null,
        vBC: null,
        vICMS: null,
        vICMSDeson: null,
        vBCST: null,
        vST: null,
        vFCP: null,
        vFCPST: null,
        vFCPSTRet: null,
        vPIS: null,
        vCOFINS: null,
        vISS: null,
        vTotTrib: null,
        vNF: null,
      },
      extensibleTotals: null,
      highlightedResidual: null,
      qualityAlert: "XML ausente ou vazio",
      lines: [],
    };
  }

  const compact = stripXmlNoise(xml);
  const ide = extractBlock(compact, "ide") ?? "";
  const finalidade = parseIntLoose(extractTag(ide, "finNFe"));
  const tpNF = parseIntLoose(extractTag(ide, "tpNF"));
  const icmsTot = extractBlock(compact, "ICMSTot");
  const totals = readTotals(icmsTot, compact);

  // ISSQNTot.vISS se ICMSTot não trouxe
  if (totals.vISS == null) {
    const issqnTot = extractBlock(compact, "ISSQNTot");
    if (issqnTot) totals.vISS = parseDecimal(extractTag(issqnTot, "vISS"));
  }

  const extensibleTotals = readExtensibleTotals(icmsTot, compact);
  if (extensibleTotals) {
    for (const [k, v] of Object.entries(extensibleTotals)) {
      if (k === "vIBS") {
        /* kept in extensible */
      }
      void v;
    }
  }

  const headerLines = buildHeaderLines(totals, Boolean(icmsTot));
  // Extensible header lines (IBS/CBS/IS)
  if (extensibleTotals) {
    for (const [tag, amount] of Object.entries(extensibleTotals)) {
      const taxType = tag.toUpperCase().includes("IBS")
        ? "IBS"
        : tag.toUpperCase().includes("CBS")
          ? "CBS"
          : tag.toUpperCase() === "VIS" || tag.toUpperCase().startsWith("VIS")
            ? "IS"
            : null;
      if (!taxType) continue;
      headerLines.push({
        lineKey: `H:${taxType}`,
        taxType,
        scope: NFE_TAX_SCOPE.HEADER,
        itemNumber: null,
        baseAmount: null,
        rate: null,
        amount: moneyOrNull(amount),
        cst: null,
        csosn: null,
        cfop: null,
        ncm: null,
        metadata: { xmlTag: tag },
        source: NFE_FISCAL_SOURCE.XML,
        sourcePath: `total/${tag}`,
      });
    }
  }

  const dets = collectBlocks(compact, "det");
  const itemLines: NfeFiscalTaxLineParsed[] = [];
  dets.forEach((body, idx) => {
    itemLines.push(...parseDetItem(body, idx + 1));
  });

  // Dedup by lineKey (keep first)
  const byKey = new Map<string, NfeFiscalTaxLineParsed>();
  for (const line of [...headerLines, ...itemLines]) {
    if (!byKey.has(line.lineKey)) byKey.set(line.lineKey, line);
  }
  const lines = [...byKey.values()];

  const alerts: string[] = [];
  if (!icmsTot) alerts.push("ICMSTot ausente");
  if (totals.vProd == null && totals.vNF == null) alerts.push("totais ausentes");
  if (dets.length === 0) alerts.push("nenhum det/item");

  const hasPartial =
    Boolean(icmsTot) && (totals.vNF == null || totals.vProd == null || dets.length === 0);

  return {
    parserVersion: NFE_FISCAL_PARSER_VERSION,
    source: hasPartial ? NFE_FISCAL_SOURCE.PARTIAL : NFE_FISCAL_SOURCE.XML,
    xmlHash,
    parsedAt,
    finalidade,
    tpNF,
    totals,
    extensibleTotals,
    highlightedResidual: computeHighlightedResidual(totals),
    qualityAlert: alerts.length > 0 ? alerts.join("; ") : null,
    lines,
  };
}

/** Soma apenas linhas HEADER do taxType (não misturar com ITEM). */
export function sumHeaderTaxAmount(
  lines: readonly NfeFiscalTaxLineParsed[],
  taxType: NfeTaxType
): number {
  return roundMoney2(
    lines
      .filter((l) => l.scope === NFE_TAX_SCOPE.HEADER && l.taxType === taxType)
      .reduce((acc, l) => acc + (l.amount ?? 0), 0)
  );
}
