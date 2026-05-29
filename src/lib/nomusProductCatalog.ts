import { Prisma, type PrismaClient } from "@prisma/client";

type JsonObject = Record<string, unknown>;

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

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/\D/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractCatalogFields(row: JsonObject) {
  const description =
    asString(row.descricao) ?? asString(row.nome) ?? asString(row.codigo) ?? asString(row.codigoProduto);
  const statusName =
    asString(row.nomeStatus) ??
    asString(row.statusNome) ??
    asString(row.status) ??
    asString(row.situacao);

  return {
    description,
    typeName: asString(row.nomeTipoProduto),
    groupName: asString(row.nomeGrupoProduto),
    familyName: asString(row.nomeFamiliaProduto),
    statusName,
    active: asBoolean(row.ativo),
  };
}

function toBlockedReasonsJson(reasons: string[] | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!reasons || reasons.length === 0) return Prisma.DbNull;
  return reasons as Prisma.InputJsonValue;
}

export type NomusProductCatalogUpsertResult = {
  upserted: number;
  skipped: number;
};

/**
 * Persiste/atualiza catálogo Nomus a partir de linhas brutas da API /produtos.
 * Inclui elegíveis e bloqueados (ex.: RAW_MATERIAL_NOT_PRODUCT).
 */
export async function upsertNomusProductCatalogFromApiRows(
  prisma: PrismaClient,
  rows: JsonObject[],
  blockedBySku: Map<string, string[]>
): Promise<NomusProductCatalogUpsertResult> {
  const syncedAt = new Date();
  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const code = asString(row.codigo) ?? asString(row.codigoProduto);
    if (!code) {
      skipped += 1;
      continue;
    }

    const externalId = toInt(row.id);
    const meta = extractCatalogFields(row);
    const blockedReasons = blockedBySku.get(code) ?? null;
    const rawPayload = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;

    const data = {
      externalProductId: externalId != null ? String(externalId) : null,
      description: meta.description,
      typeName: meta.typeName,
      groupName: meta.groupName,
      familyName: meta.familyName,
      statusName: meta.statusName,
      active: meta.active,
      rawPayload,
      blockedReasons: toBlockedReasonsJson(blockedReasons),
      syncedAt,
    };

    await prisma.nomusProductCatalog.upsert({
      where: { code },
      create: { code, ...data },
      update: data,
    });
    upserted += 1;
  }

  return { upserted, skipped };
}
