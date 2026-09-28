/**
 * Compatibilidade entre uma conferência COUNTING já existente e o setor do
 * Collector que quer continuá-la.
 *
 * InventoryCountSession não tem coluna de setor. A prova é o itemType das
 * InventoryCountLine já existentes: um setor só continua sessão cujas linhas
 * sejam TODAS do seu itemType. O prefixo do código (MP-/CP-/PA-, do contrato)
 * é apenas sinal auxiliar:
 *  - com linhas, prefixo de OUTRO setor do Collector é contradição → recusa;
 *  - sem linhas, é a única prova disponível — vale só o prefixo do próprio
 *    setor; qualquer outro caso falha fechado.
 *
 * Sessão incompatível nunca é escondida para abrir outra no mesmo almoxarifado:
 * duas COUNTING concorrentes quebrariam a consistência operacional. O erro é
 * explícito — COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE (409).
 */
import { createHash } from "node:crypto";
import type { InventoryItemType, Prisma } from "@prisma/client";
import { InventoryValidationError } from "./../inventoryTypes.js";
import {
  COLLECTOR_SECTOR_CODES,
  COLLECTOR_SECTORS,
  type CollectorSectorCode,
} from "./collectorSectorContract.js";

export const COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE = "COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE";

/** itemType contado por setor — é a identidade do setor dentro das linhas. */
export const COLLECTOR_SECTOR_ITEM_TYPE: Readonly<Record<CollectorSectorCode, InventoryItemType>> = {
  RAW_MATERIAL: "RAW_MATERIAL",
  COMPONENT: "COMPONENT",
  FINISHED_PRODUCT: "FINISHED_PRODUCT",
};

const COLLECTOR_SESSION_CODE_RE = /^([A-Z]{2})-\d{8}-\d+$/;

/**
 * Setor do Collector sinalizado pelo código da sessão (MP-/CP-/PA-AAAAMMDD-NNN).
 * null quando o código não é de setor do Collector (ex.: conferência manual CF-).
 */
export function collectorSectorFromSessionCode(
  code: string | null | undefined
): CollectorSectorCode | null {
  const match = COLLECTOR_SESSION_CODE_RE.exec(String(code ?? "").trim());
  if (!match) return null;
  return (
    COLLECTOR_SECTOR_CODES.find(
      (sector) => COLLECTOR_SECTORS[sector].sessionCodePrefix === match[1]
    ) ?? null
  );
}

export type CollectorSessionCompatibilityReason =
  | "LINES_MATCH_SECTOR"
  | "EMPTY_SESSION_OWN_PREFIX"
  | "LINES_OF_OTHER_ITEM_TYPE"
  | "PREFIX_OF_OTHER_SECTOR"
  | "EMPTY_SESSION_UNPROVEN";

export type CollectorSessionCompatibility = {
  compatible: boolean;
  reason: CollectorSessionCompatibilityReason;
};

/** Regra pura — sem I/O. foreignLineCount = linhas com itemType diferente do setor. */
export function evaluateCollectorSessionCompatibility(input: {
  sector: CollectorSectorCode;
  sessionCode: string;
  lineCount: number;
  foreignLineCount: number;
}): CollectorSessionCompatibility {
  const prefixSector = collectorSectorFromSessionCode(input.sessionCode);
  if (input.lineCount > 0) {
    if (input.foreignLineCount > 0) {
      return { compatible: false, reason: "LINES_OF_OTHER_ITEM_TYPE" };
    }
    if (prefixSector != null && prefixSector !== input.sector) {
      return { compatible: false, reason: "PREFIX_OF_OTHER_SECTOR" };
    }
    return { compatible: true, reason: "LINES_MATCH_SECTOR" };
  }
  if (prefixSector === input.sector) {
    return { compatible: true, reason: "EMPTY_SESSION_OWN_PREFIX" };
  }
  return { compatible: false, reason: "EMPTY_SESSION_UNPROVEN" };
}

type CollectorSessionDb = Pick<
  Prisma.TransactionClient,
  "inventoryCountSession" | "inventoryCountLine"
>;

function incompatibleSessionError(
  sector: CollectorSectorCode,
  sessionCode: string
): InventoryValidationError {
  const label = COLLECTOR_SECTORS[sector].label;
  return new InventoryValidationError(
    `Já existe uma conferência em contagem neste almoxarifado (${sessionCode}) que não é do setor ${label}. ` +
      `Conclua ou cancele essa conferência antes de iniciar a contagem de ${label}.`,
    COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE
  );
}

/** Total de linhas e linhas de outro itemType por sessão — 2 consultas em lote. */
async function loadSessionLineStats(
  db: CollectorSessionDb,
  sector: CollectorSectorCode,
  sessionIds: string[]
): Promise<Map<string, { lineCount: number; foreignLineCount: number }>> {
  const stats = new Map<string, { lineCount: number; foreignLineCount: number }>();
  if (sessionIds.length === 0) return stats;
  const [totals, foreign] = await Promise.all([
    db.inventoryCountLine.groupBy({
      by: ["sessionId"],
      where: { sessionId: { in: sessionIds } },
      _count: { _all: true },
    }),
    db.inventoryCountLine.groupBy({
      by: ["sessionId"],
      where: {
        sessionId: { in: sessionIds },
        item: { itemType: { not: COLLECTOR_SECTOR_ITEM_TYPE[sector] } },
      },
      _count: { _all: true },
    }),
  ]);
  for (const id of sessionIds) stats.set(id, { lineCount: 0, foreignLineCount: 0 });
  for (const row of totals) {
    const entry = stats.get(row.sessionId);
    if (entry) entry.lineCount = row._count._all;
  }
  for (const row of foreign) {
    const entry = stats.get(row.sessionId);
    if (entry) entry.foreignLineCount = row._count._all;
  }
  return stats;
}

/**
 * Falha fechado quando a sessão não pode ser continuada pelo setor.
 * Devolve o total de linhas já existente (0 = sessão vazia do próprio setor).
 */
export async function assertCollectorSessionCompatibleWithSector(
  db: CollectorSessionDb,
  input: { sector: CollectorSectorCode; session: { id: string; code: string } }
): Promise<{ lineCount: number }> {
  const stats = await loadSessionLineStats(db, input.sector, [input.session.id]);
  const entry = stats.get(input.session.id) ?? { lineCount: 0, foreignLineCount: 0 };
  const verdict = evaluateCollectorSessionCompatibility({
    sector: input.sector,
    sessionCode: input.session.code,
    lineCount: entry.lineCount,
    foreignLineCount: entry.foreignLineCount,
  });
  if (!verdict.compatible) throw incompatibleSessionError(input.sector, input.session.code);
  return { lineCount: entry.lineCount };
}

/**
 * Conferência COUNTING que o setor pode continuar no almoxarifado — ou null.
 *
 * scope "latest": só a COUNTING mais recente (fluxo atual do RAW_MATERIAL).
 * scope "all": todas as COUNTING do almoxarifado (Componentes / Produto acabado).
 * Qualquer candidata incompatível → COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE; nunca
 * é pulada para devolver outra.
 */
export async function findCollectorSectorActiveSession(
  db: CollectorSessionDb,
  input: { sector: CollectorSectorCode; warehouseId: string; scope: "latest" | "all" }
) {
  const sessions = await db.inventoryCountSession.findMany({
    where: { warehouseId: input.warehouseId, status: "COUNTING" },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      lines: { select: { countedQuantity: true } },
    },
    orderBy: { startedAt: "desc" },
    ...(input.scope === "latest" ? { take: 1 } : {}),
  });
  if (sessions.length === 0) return null;

  const stats = await loadSessionLineStats(
    db,
    input.sector,
    sessions.map((session) => session.id)
  );
  for (const session of sessions) {
    const entry = stats.get(session.id) ?? { lineCount: 0, foreignLineCount: 0 };
    const verdict = evaluateCollectorSessionCompatibility({
      sector: input.sector,
      sessionCode: session.code,
      lineCount: entry.lineCount,
      foreignLineCount: entry.foreignLineCount,
    });
    if (!verdict.compatible) throw incompatibleSessionError(input.sector, session.code);
  }
  return sessions[0];
}

/** Chaves do advisory lock de abertura de conferência Collector por almoxarifado. */
export function buildCollectorSessionWarehouseLockKeys(warehouseId: string): {
  key1: number;
  key2: number;
  lockName: string;
} {
  const lockName = `inventory:collector-count-session:${warehouseId.trim()}`;
  const digest = createHash("sha256").update(lockName).digest();
  return { key1: digest.readInt32BE(0), key2: digest.readInt32BE(4), lockName };
}

/**
 * Serializa abrir/continuar conferência Collector no mesmo almoxarifado, dentro
 * da transação (pg_advisory_xact_lock: liberado no commit/rollback). Sem ele,
 * dois toques simultâneos veriam "nenhuma COUNTING" e abririam duas sessões
 * concorrentes. Não toca linha nenhuma — não bloqueia movimentos nem FKs.
 * Sem $queryRaw (Prisma falso de teste) é no-op, como lockBalanceById.
 */
export async function lockCollectorWarehouseSessions(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  warehouseId: string
): Promise<void> {
  if (typeof tx.$queryRaw !== "function") return;
  const { key1, key2 } = buildCollectorSessionWarehouseLockKeys(warehouseId);
  // pg_advisory_xact_lock retorna void; ::text evita coluna void no $queryRaw
  // (mesmo padrão de treasuryReconciliationMatchRepository).
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key1}::int, ${key2}::int)::text AS locked`;
}
