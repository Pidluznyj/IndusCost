/**
 * Probe manual/read-only: GET /rest/documentosEstoque (Nomus).
 *
 * Não grava no banco, não chama sync oficial, não altera NF/AR/Pedidos.
 *
 * Uso:
 *   npx tsx scripts/probe-nomus-stock-documents.ts --idNfe=6937 --tipo=DocumentoSaida
 *   npx tsx scripts/probe-nomus-stock-documents.ts --idNfe=6937,7188,7377 --tipo=DocumentoSaida --limit=50
 *   npx tsx scripts/probe-nomus-stock-documents.ts --idNfe=6937 --idNfe=7188 --tipo=DocumentoSaida
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "../src/lib/nomusRestClient.ts";

const LOG_PREFIX = "[probe-nomus-documentos-estoque]";
const RESOURCE = "documentosEstoque";
const DEFAULT_TIPO = "DocumentoSaida";
const DEFAULT_LIMIT = 50;
const OUTPUT_PATH = join("tmp-audits", "nomus-documentos-estoque-probe.json");

type JsonObject = Record<string, unknown>;

type ProbeCliOptions = {
  idNfes: number[];
  tipo: string;
  limit: number;
};

type ItemSummary = {
  idProduto: unknown;
  qtde: unknown;
  valorUnitario: unknown;
  valorTotalEstimado: number | null;
  rawMinimo: JsonObject;
};

type DocumentSummary = {
  id: unknown;
  tipoDocumentoEstoque: unknown;
  idNfe: unknown;
  data: unknown;
  itensCount: number;
  itens: ItemSummary[];
};

type IdNfeProbeResult = {
  idNfe: number;
  query: string;
  endpointRedacted: string;
  documentsFound: number;
  documents: DocumentSummary[];
  error?: string;
};

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\./g, "").replace(",", ".");
    const parsed = Number.parseFloat(normalized.length > 0 ? normalized : value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toInt(value: unknown): number | null {
  const n = toNumber(value);
  return n == null ? null : Math.trunc(n);
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function pickArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asObject(payload);
  if (!obj) return [];

  const candidates = [
    obj.documentosEstoque,
    obj.documentoEstoque,
    obj.data,
    asObject(obj.data)?.documentosEstoque,
    asObject(obj.data)?.items,
    obj.results,
    obj.items,
    obj.content,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickItems(doc: JsonObject): unknown[] {
  const candidates = [
    doc.itensDocumentoEstoque,
    doc.itens,
    doc.items,
    doc.itensDocumento,
    asObject(doc.documentoEstoque)?.itensDocumentoEstoque,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function parseIdNfeList(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`idNfe inválido: ${part}`);
      }
      return n;
    });
}

function parseCli(argv: string[]): ProbeCliOptions {
  const idNfes: number[] = [];
  let tipo = DEFAULT_TIPO;
  let limit = DEFAULT_LIMIT;

  for (const arg of argv) {
    if (arg.startsWith("--idNfe=")) {
      idNfes.push(...parseIdNfeList(arg.slice("--idNfe=".length)));
      continue;
    }
    if (arg.startsWith("--tipo=")) {
      tipo = arg.slice("--tipo=".length).trim() || DEFAULT_TIPO;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--limit inválido: ${arg}`);
      }
      limit = parsed;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Uso:
  npx tsx scripts/probe-nomus-stock-documents.ts --idNfe=6937,7188,7377 --tipo=DocumentoSaida --limit=50

Somente GET read-only em /rest/documentosEstoque. Saída raw em ${OUTPUT_PATH}.`);
      process.exit(0);
    }
  }

  if (idNfes.length === 0) {
    throw new Error("Informe ao menos um --idNfe=... (ex.: --idNfe=6937,7188,7377)");
  }

  return { idNfes: [...new Set(idNfes)], tipo, limit };
}

function buildQuery(idNfe: number, tipo: string): string {
  return `idNfe==${idNfe};tipoDocumentoEstoque==${tipo}`;
}

function summarizeItem(raw: unknown): ItemSummary {
  const item = asObject(raw) ?? {};
  const idProduto = item.idProduto ?? item.produtoId ?? asObject(item.produto)?.id ?? null;
  const qtde = item.qtde ?? item.quantidade ?? item.qtd ?? null;
  const valorUnitario = item.valorUnitario ?? item.precoUnitario ?? item.vlUnitario ?? null;
  const qtdeN = toNumber(qtde);
  const unitN = toNumber(valorUnitario);
  const valorTotalEstimado =
    qtdeN != null && unitN != null ? Number((qtdeN * unitN).toFixed(6)) : toNumber(item.valorTotal);

  return {
    idProduto,
    qtde,
    valorUnitario,
    valorTotalEstimado,
    rawMinimo: {
      id: item.id ?? null,
      idProduto,
      qtde,
      quantidade: item.quantidade ?? null,
      valorUnitario,
      valorTotal: item.valorTotal ?? null,
      codigoProduto: item.codigoProduto ?? asObject(item.produto)?.codigo ?? null,
      descricaoProduto:
        item.descricaoProduto ?? asObject(item.produto)?.descricao ?? asObject(item.produto)?.nome ?? null,
    },
  };
}

function summarizeDocument(raw: unknown, fallbackIdNfe: number): DocumentSummary {
  const doc = asObject(raw) ?? {};
  const items = pickItems(doc).map(summarizeItem);
  return {
    id: doc.id ?? doc.idDocumentoEstoque ?? null,
    tipoDocumentoEstoque: doc.tipoDocumentoEstoque ?? doc.tipo ?? null,
    idNfe: doc.idNfe ?? toInt(doc.idNfe) ?? fallbackIdNfe,
    data: doc.data ?? doc.dataDocumento ?? doc.dataEmissao ?? doc.dataMovimento ?? null,
    itensCount: items.length,
    itens: items,
  };
}

function printIdNfeSummary(result: IdNfeProbeResult): void {
  console.warn(`\n${LOG_PREFIX} ── idNfe=${result.idNfe} ──`);
  if (result.error) {
    console.warn(`${LOG_PREFIX} erro: ${result.error}`);
    return;
  }
  console.warn(`${LOG_PREFIX} query=${result.query}`);
  console.warn(`${LOG_PREFIX} documentos encontrados=${result.documentsFound}`);
  for (const doc of result.documents) {
    console.warn(
      `${LOG_PREFIX}   doc id=${String(doc.id)} tipo=${String(doc.tipoDocumentoEstoque)} idNfe=${String(doc.idNfe)} data=${String(doc.data)} itens=${doc.itensCount}`
    );
    for (const item of doc.itens) {
      console.warn(
        `${LOG_PREFIX}     item idProduto=${String(item.idProduto)} qtde=${String(item.qtde)} valorUnitario=${String(item.valorUnitario)} valorTotalEstimado=${item.valorTotalEstimado ?? "n/a"}`
      );
    }
  }
}

async function probeOne(
  baseUrl: string,
  idNfe: number,
  tipo: string,
  limit: number
): Promise<{ result: IdNfeProbeResult; rawPayload: unknown }> {
  const query = buildQuery(idNfe, tipo);
  const url = buildNomusUrl(baseUrl, RESOURCE, {
    query,
    pagina: "1",
    tamanhoPagina: String(limit),
  });
  const endpointRedacted = redactNomusUrlForLog(url);

  try {
    const rawPayload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
    const docs = pickArray(rawPayload)
      .map((row) => summarizeDocument(row, idNfe))
      .slice(0, limit);

    return {
      result: {
        idNfe,
        query,
        endpointRedacted,
        documentsFound: docs.length,
        documents: docs,
      },
      rawPayload,
    };
  } catch (error) {
    return {
      result: {
        idNfe,
        query,
        endpointRedacted,
        documentsFound: 0,
        documents: [],
        error: error instanceof Error ? error.message : String(error),
      },
      rawPayload: null,
    };
  }
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");

  const envForLog = redactHeadersForLog(
    Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key.startsWith("NOMUS_"))
        .map(([key, value]) => [key, value ?? ""])
    )
  );

  console.warn(`${LOG_PREFIX} read-only probe — sem escrita em banco / sem sync oficial`);
  console.warn(
    `${LOG_PREFIX} idNfes=${options.idNfes.join(",")} tipo=${options.tipo} limit=${options.limit}`
  );
  console.warn(`${LOG_PREFIX} env Nomus (redigido): ${JSON.stringify(envForLog)}`);
  console.warn(
    `${LOG_PREFIX} credencial: ${JSON.stringify(
      describeNomusCredential(process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN || process.env.NOMUS_AUTH)
    )}`
  );

  const byIdNfe: IdNfeProbeResult[] = [];
  const rawByIdNfe: Record<string, unknown> = {};
  let hadError = false;

  for (const idNfe of options.idNfes) {
    const { result, rawPayload } = await probeOne(baseUrl, idNfe, options.tipo, options.limit);
    byIdNfe.push(result);
    rawByIdNfe[String(idNfe)] = rawPayload;
    if (result.error) hadError = true;
    printIdNfeSummary(result);
  }

  const output = {
    probedAt: new Date().toISOString(),
    resource: RESOURCE,
    method: "GET",
    readOnly: true,
    options,
    summary: byIdNfe.map((row) => ({
      idNfe: row.idNfe,
      documentsFound: row.documentsFound,
      error: row.error ?? null,
      documents: row.documents.map((doc) => ({
        id: doc.id,
        tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
        idNfe: doc.idNfe,
        data: doc.data,
        itensDocumentoEstoqueCount: doc.itensCount,
        itens: doc.itens,
      })),
    })),
    rawByIdNfe,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.warn(`\n${LOG_PREFIX} raw salvo em ${OUTPUT_PATH}`);

  const totals = byIdNfe.map((row) => `${row.idNfe}:${row.documentsFound}`).join(" ");
  console.warn(`${LOG_PREFIX} totais documentos por idNfe → ${totals}`);

  if (hadError) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
