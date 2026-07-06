/**
 * Extração de NF-e do payload Nomus — sem Prisma (seguro no bundle do navegador).
 */

type JsonObject = Record<string, unknown>;

export type ExtractedSalesOrderNfe = {
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeStatus: number | null;
  tipoOperacao: number | null;
  tipoEmissao: number | null;
  dataProcessamento: Date | null;
  horaProcessamento: string | null;
  cnpjEmitente: string | null;
  protocolo: string | null;
  recibo: string | null;
  usuario: string | null;
  ambiente: number | null;
  finalidade: number | null;
  isFornecedor: number | null;
  rawPayload: JsonObject;
};

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseNomusNfeProcessingDate(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw) return null;

  const br = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (br) {
    const dd = Number.parseInt(br[1], 10);
    const mm = Number.parseInt(br[2], 10);
    const yearRaw = Number.parseInt(br[3], 10);
    const yyyy = br[3].length === 2 ? 2000 + yearRaw : yearRaw;
    const hh = Number.parseInt(br[4] ?? "0", 10);
    const mi = Number.parseInt(br[5] ?? "0", 10);
    const ss = Number.parseInt(br[6] ?? "0", 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const parsed = new Date(yyyy, mm - 1, dd, hh, mi, ss);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function mapNomusNfeRecord(raw: JsonObject): ExtractedSalesOrderNfe | null {
  const nfeExternalId = toInt(raw.id);
  if (nfeExternalId == null) return null;

  return {
    nfeExternalId,
    nfeNumber:
      asString(raw.numero) ?? (raw.numero != null && raw.numero !== "" ? String(raw.numero) : null),
    nfeSerie: asString(raw.serie) ?? (raw.serie != null && raw.serie !== "" ? String(raw.serie) : null),
    nfeKey: asString(raw.chave) ?? asString(raw.chaveAcesso) ?? asString(raw.chNFe),
    nfeStatus: toInt(raw.status),
    tipoOperacao: toInt(raw.tipoOperacao),
    tipoEmissao: toInt(raw.tipoEmissao),
    dataProcessamento: parseNomusNfeProcessingDate(raw.dataProcessamento),
    horaProcessamento: asString(raw.horaProcessamento),
    cnpjEmitente: asString(raw.cnpjEmitente),
    protocolo: asString(raw.protocolo),
    recibo: asString(raw.recibo),
    usuario: asString(raw.usuario),
    ambiente: toInt(raw.ambiente),
    finalidade: toInt(raw.finalidade),
    isFornecedor: toInt(raw.isFornecedor),
    rawPayload: raw,
  };
}

export function extractSalesOrderNfesFromNomusPayload(payload: unknown): ExtractedSalesOrderNfe[] {
  const root = asObject(payload);
  if (!root || !Array.isArray(root.nfes)) return [];

  const byId = new Map<number, ExtractedSalesOrderNfe>();
  for (const entry of root.nfes) {
    const obj = asObject(entry);
    if (!obj) continue;
    const mapped = mapNomusNfeRecord(obj);
    if (!mapped) continue;
    byId.set(mapped.nfeExternalId, mapped);
  }
  return [...byId.values()];
}
