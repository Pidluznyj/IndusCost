import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseNomusBrDate, parseNomusBrDateTime } from "@/src/lib/nomusAccountsPayableParser.js";
import {
  classifyNomusNfeBilling,
  computeNomusNfeFiscalFlags,
} from "@/src/lib/nomusNfeClassification.js";
import {
  computeValorLiquido,
  parseNfeXmlContent,
} from "@/src/lib/nomusNfeXmlParser.js";

export type JsonObject = Record<string, unknown>;

export type MappedNomusNfe = {
  externalId: number;
  chave: string | null;
  numero: string | null;
  serie: string | null;
  status: number | null;
  tipoOperacao: number | null;
  tipoEmissao: number | null;
  finalidade: number | null;
  isFornecedor: number | null;
  ambiente: number | null;
  cnpjEmitente: string | null;
  protocolo: string | null;
  recibo: string | null;
  dataProcessamento: Date | null;
  horaProcessamento: string | null;
  xmlRaw: string | null;
  xmlCancelamento: string | null;
  justificativaCancelamento: string | null;
  xmlNatOp: string | null;
  xmlDhEmi: Date | null;
  xmlTpNF: number | null;
  xmlDestCnpjCpf: string | null;
  xmlVProd: Prisma.Decimal | null;
  xmlVDesc: Prisma.Decimal | null;
  xmlVNF: Prisma.Decimal | null;
  valorLiquido: Prisma.Decimal | null;
  billingClassification: ReturnType<typeof classifyNomusNfeBilling>;
  isFiscalBilling: boolean;
  isMarketSale: boolean;
  xmlQualityAlert: string | null;
  rawPayload: JsonObject;
  payloadHash: string;
};

export type MapNfeResult =
  | { ok: true; row: MappedNomusNfe }
  | { ok: false; reasons: string[]; externalId: number | null };

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toOptionalDecimal(value: number | null): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Prisma.Decimal(value);
}

export function stableNomusNfePayloadHash(raw: JsonObject): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

export function mapNomusNfePayload(raw: JsonObject): MapNfeResult {
  const externalId = toInt(raw.id ?? raw.ID ?? raw.externalId);
  if (externalId == null) {
    return { ok: false, reasons: ["id ausente"], externalId: null };
  }

  const xmlRaw = asString(raw.xml ?? raw.XML);
  const parsedXml = parseNfeXmlContent(xmlRaw);
  const valorLiquidoNum = computeValorLiquido(parsedXml.vProd, parsedXml.vDesc);
  const billingClassification = classifyNomusNfeBilling({
    natOp: parsedXml.natOp,
    destCnpjCpf: parsedXml.destCnpjCpf,
  });

  const status = toInt(raw.status);
  const tipoOperacao = toInt(raw.tipoOperacao ?? raw.tipo_operacao);
  const isFornecedor = toInt(raw.isFornecedor ?? raw.is_fornecedor);
  const ambiente = toInt(raw.ambiente);
  const fiscalFlags = computeNomusNfeFiscalFlags({
    status,
    tipoOperacao,
    isFornecedor,
    ambiente,
    xmlTpNF: parsedXml.tpNF,
    billingClassification,
  });

  const dataProcessamento =
    parseNomusBrDate(asString(raw.dataProcessamento)) ??
    parseNomusBrDateTime(asString(raw.dataProcessamento));

  return {
    ok: true,
    row: {
      externalId,
      chave: asString(raw.chave),
      numero: asString(raw.numero ?? raw.number),
      serie: asString(raw.serie),
      status,
      tipoOperacao,
      tipoEmissao: toInt(raw.tipoEmissao ?? raw.tipo_emissao),
      finalidade: toInt(raw.finalidade),
      isFornecedor,
      ambiente,
      cnpjEmitente: asString(raw.cnpjEmitente ?? raw.cnpj_emitente),
      protocolo: asString(raw.protocolo),
      recibo: asString(raw.recibo),
      dataProcessamento,
      horaProcessamento: asString(raw.horaProcessamento ?? raw.hora_processamento),
      xmlRaw,
      xmlCancelamento: asString(raw.xmlCancelamento ?? raw.xml_cancelamento),
      justificativaCancelamento: asString(
        raw.justificativaCancelamento ?? raw.justificativa_cancelamento
      ),
      xmlNatOp: parsedXml.natOp,
      xmlDhEmi: parsedXml.dhEmi,
      xmlTpNF: parsedXml.tpNF,
      xmlDestCnpjCpf: parsedXml.destCnpjCpf,
      xmlVProd: toOptionalDecimal(parsedXml.vProd),
      xmlVDesc: toOptionalDecimal(parsedXml.vDesc),
      xmlVNF: toOptionalDecimal(parsedXml.vNF),
      valorLiquido: toOptionalDecimal(valorLiquidoNum),
      billingClassification,
      isFiscalBilling: fiscalFlags.isFiscalBilling,
      isMarketSale: fiscalFlags.isMarketSale,
      xmlQualityAlert: parsedXml.qualityAlert,
      rawPayload: raw,
      payloadHash: stableNomusNfePayloadHash(raw),
    },
  };
}
