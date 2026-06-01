import "dotenv/config";
import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { parseNomusPtBrNumber } from "./nomusNumberParser.ts";

const prisma = new PrismaClient();

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;
const DEFAULT_MAX_PAGES = 300;
const DEFAULT_DELAY_MS = 1200;

type JsonObject = Record<string, unknown>;

type EligibleRow = {
  externalLineId: number;
  listaMateriaisId: number | null;
  listaMateriaisNome: string | null;
  listaMateriaisDescricao: string | null;
  listaMateriaisAtivo: boolean | null;
  listaMateriaisPadrao: boolean | null;
  listaMateriaisPadraoBlocoK: boolean | null;
  listaMateriaisQtdeBase: Prisma.Decimal | null;
  parentExternalProductId: number | null;
  parentCode: string;
  parentDescription: string | null;
  parentProdutoFantasma: boolean | null;
  parentServicoIndustrializacaoTerceiros: boolean | null;
  componentExternalProductId: number | null;
  componentCode: string;
  componentDescription: string | null;
  componentProdutoFantasma: boolean | null;
  componentServicoIndustrializacaoTerceiros: boolean | null;
  qtdeNecessaria: Prisma.Decimal | null;
  qtdePerdaNormal: Prisma.Decimal | null;
  naturezaConsumo: number | null;
  posicao: number | null;
  alternativo: boolean | null;
  opcional: boolean | null;
  preferencial: boolean | null;
  itemDeEmbarque: boolean | null;
  recebeComponenteTerceirosIndustrializacao: boolean | null;
  remeteComponenteIndustrializacaoTerceiros: boolean | null;
  nomusCreatedAtRaw: string | null;
  nomusUpdatedAtRaw: string | null;
  rawPayload: JsonObject;
  payloadHash: string;
  isActiveDefault: boolean;
};

type BlockedRow = {
  externalLineId: number | null;
  parentCode: string | null;
  componentCode: string | null;
  reasons: string[];
};

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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "sim", "yes"].includes(v)) return true;
    if (["false", "0", "nao", "não", "no"].includes(v)) return false;
  }
  return null;
}

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNomusHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = (process.env.NOMUS_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const customHeaderName = (process.env.NOMUS_AUTH_HEADER_NAME ?? "").trim();
  const customHeaderValue = (process.env.NOMUS_AUTH_HEADER_VALUE ?? "").trim();
  if (customHeaderName && customHeaderValue) headers[customHeaderName] = customHeaderValue;
  return headers;
}

function buildNomusUrl(baseUrl: string, resource: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedResource = resource.replace(/^\/+/, "");
  return new URL(normalizedResource, normalizedBase);
}

async function fetchJsonWithRetry(url: URL, maxRetries: number, retryBaseMs: number): Promise<unknown> {
  const headers = buildNomusHeaders();
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, { method: "GET", headers });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => "");
    if (res.status === 429 && attempt < maxRetries) {
      let waitMs: number | null = null;
      try {
        const parsed = JSON.parse(body) as { tempoAteLiberar?: unknown };
        const tempoAteLiberar = toInt(parsed?.tempoAteLiberar);
        if (tempoAteLiberar != null && tempoAteLiberar > 0) {
          waitMs = tempoAteLiberar * 1000 + 1000;
        }
      } catch {
        waitMs = null;
      }
      if (waitMs == null) {
        const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000 + 1000
            : retryBaseMs * Math.pow(2, attempt);
      }
      console.warn(
        `[nomus-bom-components-v1] rate limit 429; aguardando ${(waitMs / 1000).toFixed(0)}s antes de tentar novamente.`
      );
      await sleep(waitMs);
      continue;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) {
      throw new Error(`Falha HTTP ${res.status} em ${url.toString()}: ${body.slice(0, 300)}`);
    }
    await sleep(retryBaseMs * Math.pow(2, attempt));
  }
  throw new Error("Estado inesperado no retry HTTP.");
}

function pickArrayFromUnknown(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates = [
    data.componentesListaMateriais,
    data.data,
    data.items,
    data.results,
    data.registros,
    data.content,
    (data.data as Record<string, unknown> | undefined)?.componentesListaMateriais,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function hasNextPage(payload: unknown, page: number, currentLen: number): boolean {
  if (!payload || typeof payload !== "object") return currentLen > 0;
  if (Array.isArray(payload)) return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages = toInt(data.totalPaginas) ?? toInt(data.totalPages) ?? toInt(data.paginas);
  if (totalPages != null) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen > 0;
}

function toOptionalDecimal(raw: unknown): Prisma.Decimal | null {
  if (raw == null) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const n = parseNomusPtBrNumber(raw);
  return new Prisma.Decimal(n);
}

function computeIsActiveDefault(listaMateriais: JsonObject | null): boolean {
  if (!listaMateriais) return false;
  if (asBoolean(listaMateriais.ativo) !== true) return false;
  if (asBoolean(listaMateriais.padrao) === true) return true;
  if (asBoolean(listaMateriais.padraoBlocoK) === true) return true;
  const nome = (asString(listaMateriais.nome) ?? "").toLowerCase();
  return nome === "principal";
}

function stablePayloadHash(raw: JsonObject): string {
  return crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

function asProductObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function mapRow(raw: JsonObject): { eligible: EligibleRow | null; blocked: BlockedRow | null } {
  const externalLineId = toInt(raw.id);
  const produtoPai = asProductObject(raw.produtoPai);
  const produtoComponente = asProductObject(raw.produtoComponente);
  const listaMateriais = asProductObject(raw.listaMateriais);

  const parentCode = asString(produtoPai?.codigo);
  const componentCode = asString(produtoComponente?.codigo);

  const reasons: string[] = [];
  if (externalLineId == null) reasons.push("MISSING_EXTERNAL_LINE_ID");
  if (!parentCode) reasons.push("MISSING_PARENT_CODE");
  if (!componentCode) reasons.push("MISSING_COMPONENT_CODE");

  if (reasons.length > 0) {
    return {
      eligible: null,
      blocked: {
        externalLineId,
        parentCode,
        componentCode,
        reasons,
      },
    };
  }

  const eligible: EligibleRow = {
    externalLineId: externalLineId!,
    listaMateriaisId: toInt(listaMateriais?.id),
    listaMateriaisNome: asString(listaMateriais?.nome),
    listaMateriaisDescricao: asString(listaMateriais?.descricao),
    listaMateriaisAtivo: asBoolean(listaMateriais?.ativo),
    listaMateriaisPadrao: asBoolean(listaMateriais?.padrao),
    listaMateriaisPadraoBlocoK: asBoolean(listaMateriais?.padraoBlocoK),
    listaMateriaisQtdeBase: toOptionalDecimal(listaMateriais?.qtdeBase),
    parentExternalProductId: toInt(produtoPai?.id),
    parentCode: parentCode!,
    parentDescription: asString(produtoPai?.descricao),
    parentProdutoFantasma: asBoolean(produtoPai?.produtoFantasma),
    parentServicoIndustrializacaoTerceiros: asBoolean(produtoPai?.servicoIndustrializacaoTerceiros),
    componentExternalProductId: toInt(produtoComponente?.id),
    componentCode: componentCode!,
    componentDescription: asString(produtoComponente?.descricao),
    componentProdutoFantasma: asBoolean(produtoComponente?.produtoFantasma),
    componentServicoIndustrializacaoTerceiros: asBoolean(produtoComponente?.servicoIndustrializacaoTerceiros),
    qtdeNecessaria: toOptionalDecimal(raw.qtdeNecessaria),
    qtdePerdaNormal: toOptionalDecimal(raw.qtdePerdaNormal),
    naturezaConsumo: toInt(raw.naturezaConsumo),
    posicao: toInt(raw.posicao),
    alternativo: asBoolean(raw.alternativo),
    opcional: asBoolean(raw.opcional),
    preferencial: asBoolean(raw.preferencial),
    itemDeEmbarque: asBoolean(raw.itemDeEmbarque),
    recebeComponenteTerceirosIndustrializacao: asBoolean(raw.recebeComponenteTerceirosIndustrializacao),
    remeteComponenteIndustrializacaoTerceiros: asBoolean(raw.remeteComponenteIndustrializacaoTerceiros),
    nomusCreatedAtRaw: asString(raw.dataCriacao),
    nomusUpdatedAtRaw: asString(raw.dataModificacao),
    rawPayload: raw,
    payloadHash: stablePayloadHash(raw),
    isActiveDefault: computeIsActiveDefault(listaMateriais),
  };

  return { eligible, blocked: null };
}

async function fetchAllNomusBomComponents(
  baseUrl: string
): Promise<{ rows: JsonObject[]; fetchComplete: boolean }> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const startPage = Math.max(1, toInt(process.env.NOMUS_BOM_COMPONENTS_START_PAGE) ?? 1);
  const maxPages =
    toInt(process.env.NOMUS_BOM_COMPONENTS_MAX_PAGES) ??
    toInt(process.env.NOMUS_MAX_PAGES) ??
    DEFAULT_MAX_PAGES;
  const delayMs = Math.max(0, toInt(process.env.NOMUS_BOM_COMPONENTS_DELAY_MS) ?? DEFAULT_DELAY_MS);
  const lastPage = startPage + Math.max(1, maxPages) - 1;

  const rows: JsonObject[] = [];
  let page = startPage;
  let fetchComplete = false;

  while (true) {
    const url = buildNomusUrl(baseUrl, "componentesListaMateriais");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));
    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter((x): x is JsonObject => !!x && typeof x === "object");
    if (arr.length === 0) {
      fetchComplete = true;
      break;
    }
    rows.push(...arr);
    console.warn(
      `[nomus-bom-components-v1] página ${page} lida com ${arr.length} linhas; acumulado=${rows.length}.`
    );
    if (page >= lastPage) {
      console.warn(
        `[nomus-bom-components-v1] limite de bloco atingido: startPage=${startPage}, maxPages=${maxPages}, lastPage=${lastPage}.`
      );
      fetchComplete = false;
      break;
    }
    if (!hasNextPage(payload, page, arr.length)) {
      fetchComplete = true;
      break;
    }
    page += 1;
    if (delayMs > 0) await sleep(delayMs);
  }

  return { rows, fetchComplete };
}

function buildStageData(row: EligibleRow, fetchedAt: Date, runId: string): Prisma.NomusBomComponentStageUncheckedCreateInput {
  return {
    externalLineId: row.externalLineId,
    listaMateriaisId: row.listaMateriaisId,
    listaMateriaisNome: row.listaMateriaisNome,
    listaMateriaisDescricao: row.listaMateriaisDescricao,
    listaMateriaisAtivo: row.listaMateriaisAtivo,
    listaMateriaisPadrao: row.listaMateriaisPadrao,
    listaMateriaisPadraoBlocoK: row.listaMateriaisPadraoBlocoK,
    listaMateriaisQtdeBase: row.listaMateriaisQtdeBase,
    parentExternalProductId: row.parentExternalProductId,
    parentCode: row.parentCode,
    parentDescription: row.parentDescription,
    parentProdutoFantasma: row.parentProdutoFantasma,
    parentServicoIndustrializacaoTerceiros: row.parentServicoIndustrializacaoTerceiros,
    componentExternalProductId: row.componentExternalProductId,
    componentCode: row.componentCode,
    componentDescription: row.componentDescription,
    componentProdutoFantasma: row.componentProdutoFantasma,
    componentServicoIndustrializacaoTerceiros: row.componentServicoIndustrializacaoTerceiros,
    qtdeNecessaria: row.qtdeNecessaria,
    qtdePerdaNormal: row.qtdePerdaNormal,
    naturezaConsumo: row.naturezaConsumo,
    posicao: row.posicao,
    alternativo: row.alternativo,
    opcional: row.opcional,
    preferencial: row.preferencial,
    itemDeEmbarque: row.itemDeEmbarque,
    recebeComponenteTerceirosIndustrializacao: row.recebeComponenteTerceirosIndustrializacao,
    remeteComponenteIndustrializacaoTerceiros: row.remeteComponenteIndustrializacaoTerceiros,
    nomusCreatedAtRaw: row.nomusCreatedAtRaw,
    nomusUpdatedAtRaw: row.nomusUpdatedAtRaw,
    rawPayload: row.rawPayload as Prisma.InputJsonValue,
    payloadHash: row.payloadHash,
    fetchedAt,
    syncedAt: fetchedAt,
    runId,
    isActiveDefault: row.isActiveDefault,
  };
}

async function runApply(
  eligible: EligibleRow[],
  fetchedAt: Date,
  runId: string
): Promise<{ created: number; updated: number; unchanged: number; touched: number }> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let touched = 0;

  for (const row of eligible) {
    const data = buildStageData(row, fetchedAt, runId);
    const existing = await prisma.nomusBomComponentStage.findUnique({
      where: { externalLineId: row.externalLineId },
      select: { id: true, payloadHash: true },
    });

    if (!existing) {
      await prisma.nomusBomComponentStage.create({ data });
      created += 1;
      touched += 1;
      continue;
    }

    if (existing.payloadHash === row.payloadHash) {
      await prisma.nomusBomComponentStage.update({
        where: { externalLineId: row.externalLineId },
        data: {
          runId,
          fetchedAt,
          syncedAt: fetchedAt,
        },
      });
      unchanged += 1;
      touched += 1;
      continue;
    }

    await prisma.nomusBomComponentStage.update({
      where: { externalLineId: row.externalLineId },
      data: {
        ...data,
        syncedAt: fetchedAt,
      },
    });
    updated += 1;
    touched += 1;
  }

  return { created, updated, unchanged, touched };
}

async function reconcileRemovedStageLines(seenExternalLineIds: number[]): Promise<number> {
  if (seenExternalLineIds.length === 0) return 0;
  const removed = await prisma.nomusBomComponentStage.deleteMany({
    where: { externalLineId: { notIn: seenExternalLineIds } },
  });
  return removed.count;
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const startedAt = new Date();
  const runId = crypto.randomUUID();
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");

  const { rows: raw, fetchComplete } = await fetchAllNomusBomComponents(baseUrl);
  const eligible: EligibleRow[] = [];
  const blocked: BlockedRow[] = [];

  for (const row of raw) {
    const mapped = mapRow(row);
    if (mapped.eligible) eligible.push(mapped.eligible);
    if (mapped.blocked) blocked.push(mapped.blocked);
  }

  const seenExternalLineIds = eligible.map((r) => r.externalLineId);

  const blockedReasons: Record<string, number> = {};
  for (const b of blocked) {
    for (const r of b.reasons) blockedReasons[r] = (blockedReasons[r] ?? 0) + 1;
  }

  const parentCodes = new Set(eligible.map((r) => r.parentCode));
  const componentCodes = new Set(eligible.map((r) => r.componentCode));

  const examples = eligible.slice(0, 8).map((r) => ({
    externalLineId: r.externalLineId,
    parentCode: r.parentCode,
    componentCode: r.componentCode,
    qtdeNecessaria: r.qtdeNecessaria?.toString() ?? null,
    listaMateriaisNome: r.listaMateriaisNome,
    isActiveDefault: r.isActiveDefault,
    opcional: r.opcional,
    alternativo: r.alternativo,
    preferencial: r.preferencial,
  }));

  const summary = {
    totalRead: raw.length,
    eligibleCount: eligible.length,
    blockedCount: blocked.length,
    totalParents: parentCodes.size,
    totalComponents: componentCodes.size,
    activeDefaultRows: eligible.filter((r) => r.isActiveDefault).length,
    optionalRows: eligible.filter((r) => r.opcional === true).length,
    alternativeRows: eligible.filter((r) => r.alternativo === true).length,
    preferredRows: eligible.filter((r) => r.preferencial === true).length,
    blockedReasons,
    examples,
    blockedPreview: blocked.slice(0, 20),
  };

  const applied = isApply
    ? await runApply(eligible, startedAt, runId)
    : { created: 0, updated: 0, unchanged: 0, touched: 0 };

  let removedStale = 0;
  if (isApply && fetchComplete && seenExternalLineIds.length > 0) {
    removedStale = await reconcileRemovedStageLines(seenExternalLineIds);
    if (removedStale > 0) {
      console.warn(
        `[nomus-bom-components-v1] reconciliação: ${removedStale} linha(s) removida(s) do stage (ausentes na API atual).`
      );
    }
  } else if (isApply && !fetchComplete) {
    console.warn(
      "[nomus-bom-components-v1] fetch incompleto — reconciliação de linhas removidas foi ignorada por segurança."
    );
  }

  const finishedAt = new Date();

  console.log(
    JSON.stringify(
      {
        mode: isApply ? "apply" : "dry",
        target: "bom-components",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        runId,
        fetchComplete,
        summary,
        applied: { ...applied, removedStale },
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[nomus-bom-components-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
