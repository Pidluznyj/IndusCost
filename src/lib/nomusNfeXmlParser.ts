/** Parse resiliente de campos fiscais no XML NF-e (sem dependência externa). */

export type ParsedNfeXmlFields = {
  natOp: string | null;
  dhEmi: Date | null;
  tpNF: number | null;
  destCnpjCpf: string | null;
  vProd: number | null;
  vDesc: number | null;
  vNF: number | null;
  qualityAlert: string | null;
};

function extractXmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const match = re.exec(xml);
  if (!match) return null;
  const value = match[1]?.trim();
  return value || null;
}

function parseXmlDecimal(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(",", ".").trim();
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseXmlInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseDhEmi(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (brMatch) {
    const [, dd, mm, yyyy, hh = "0", min = "0", ss = "0"] = brMatch;
    const dt = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss)
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function normalizeDocumentDigits(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 11 ? digits : null;
}

export function parseNfeXmlContent(xml: string | null | undefined): ParsedNfeXmlFields {
  if (!xml || typeof xml !== "string" || !xml.trim()) {
    return {
      natOp: null,
      dhEmi: null,
      tpNF: null,
      destCnpjCpf: null,
      vProd: null,
      vDesc: null,
      vNF: null,
      qualityAlert: "XML ausente ou vazio",
    };
  }

  const compact = xml.replace(/\s+/g, " ");
  const natOp = extractXmlTag(compact, "natOp");
  const dhEmi = parseDhEmi(extractXmlTag(compact, "dhEmi"));
  const tpNF = parseXmlInt(extractXmlTag(compact, "tpNF"));

  let destCnpjCpf: string | null = null;
  const destBlock = /<dest[^>]*>([\s\S]*?)<\/dest>/i.exec(compact);
  if (destBlock) {
    destCnpjCpf =
      normalizeDocumentDigits(extractXmlTag(destBlock[1], "CNPJ")) ??
      normalizeDocumentDigits(extractXmlTag(destBlock[1], "CPF"));
  }

  const icmsBlock = /<ICMSTot[^>]*>([\s\S]*?)<\/ICMSTot>/i.exec(compact);
  const totalsSource = icmsBlock?.[1] ?? compact;
  const vProd = parseXmlDecimal(extractXmlTag(totalsSource, "vProd"));
  const vDesc = parseXmlDecimal(extractXmlTag(totalsSource, "vDesc"));
  const vNF = parseXmlDecimal(extractXmlTag(totalsSource, "vNF"));

  const alerts: string[] = [];
  if (!natOp) alerts.push("natOp ausente");
  if (!dhEmi) alerts.push("dhEmi ausente ou inválido");
  if (tpNF == null) alerts.push("tpNF ausente");
  if (vProd == null && vNF == null) alerts.push("valores totais ausentes");

  return {
    natOp,
    dhEmi,
    tpNF,
    destCnpjCpf,
    vProd,
    vDesc,
    vNF,
    qualityAlert: alerts.length > 0 ? alerts.join("; ") : null,
  };
}

export function computeValorLiquido(vProd: number | null, vDesc: number | null): number | null {
  if (vProd == null) return null;
  const desc = vDesc ?? 0;
  const value = vProd - desc;
  return Number.isFinite(value) ? value : null;
}
