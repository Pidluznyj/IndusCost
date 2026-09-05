import "dotenv/config";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactNomusUrlForLog,
} from "@/src/lib/nomusRestClient.js";
import { extractDirectNomusNfeRefs, extractDocumentEntryPurchaseOrderId } from "@/src/lib/nomus/nomusPurchaseOrder360.js";

const LOG_PREFIX = "[nomus-purchase-orders-relations-probe]";
const RELATIONAL_KEY_RE =
  /^(id|idNfe|idPedido|idPedidoCompra|codigoPedido|nfes|numeroNota|sourceInvoice|idPessoa|idProduto)/i;

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listRelationalKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.slice(0, 3).flatMap((item, index) => listRelationalKeys(item, `${prefix}[${index}]`));
  }
  const obj = asObject(value);
  if (!obj) return [];
  const keys: string[] = [];
  for (const [key, child] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (RELATIONAL_KEY_RE.test(key)) keys.push(path);
    if (child && typeof child === "object") {
      keys.push(...listRelationalKeys(child, path));
    }
  }
  return [...new Set(keys)].slice(0, 80);
}

function parseArgs(argv: string[]) {
  const raw = argv.find((arg) => /^\d+$/.test(arg)) ?? argv.find((arg) => arg.startsWith("--id="))?.slice(5);
  const id = Number.parseInt(raw ?? "613", 10);
  return { id: Number.isFinite(id) && id > 0 ? id : 613 };
}

async function main() {
  const { id } = parseArgs(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  console.warn(`${LOG_PREFIX} credencial=${JSON.stringify(describeNomusCredential(process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN))}`);
  console.warn(`${LOG_PREFIX} persist=false write=false`);

  const detailUrl = buildNomusUrl(baseUrl, `pedidoscompra/${id}`);
  console.warn(`${LOG_PREFIX} GET ${redactNomusUrlForLog(detailUrl)}`);
  const detail = await fetchNomusJson(detailUrl, {
    logPrefix: LOG_PREFIX,
    maxRetries: 2,
    logContext: { resource: "pedidoscompra", id },
  });
  const detailObj = asObject(detail);
  const nfes = extractDirectNomusNfeRefs(detail);

  const stockUrl = buildNomusUrl(baseUrl, "documentosEstoque", { pagina: "1", tamanhoPagina: "1" });
  console.warn(`${LOG_PREFIX} GET ${redactNomusUrlForLog(stockUrl)}`);
  let stockKeys: string[] = [];
  let stockPurchaseOrderId: number | null = null;
  try {
    const stock = await fetchNomusJson(stockUrl, {
      logPrefix: LOG_PREFIX,
      maxRetries: 2,
      logContext: { resource: "documentosEstoque", page: 1 },
    });
    const first = Array.isArray(stock) ? stock[0] : asObject(stock)?.dados ?? stock;
    const sample = Array.isArray(first) ? first[0] : first;
    stockKeys = listRelationalKeys(sample);
    stockPurchaseOrderId = extractDocumentEntryPurchaseOrderId(sample);
  } catch (error) {
    console.warn(`${LOG_PREFIX} documentosEstoque probe falhou de forma read-only: ${error instanceof Error ? error.message : "erro"}`);
  }

  console.warn(
    JSON.stringify(
      {
        ok: true,
        persist: false,
        write: false,
        purchaseOrderId: id,
        detailRelationalKeys: listRelationalKeys(detail),
        nfesCount: nfes.length,
        nfeIds: nfes.map((row) => row.externalId),
        hasNfesArray: Array.isArray(detailObj?.nfes),
        stockDocumentRelationalKeys: stockKeys,
        stockDocumentPurchaseOrderId: stockPurchaseOrderId,
        documentEntryLinkDiscovered: stockPurchaseOrderId != null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
