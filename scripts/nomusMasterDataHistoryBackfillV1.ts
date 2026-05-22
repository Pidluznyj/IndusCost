/**
 * Backfill idempotente de histórico para itens criados pela Carga Mestre Nomus.
 *
 * Para cada Product (isNomusControlled=true ou sourceSystem=NOMUS) e cada
 * Material (category=NOMUS_IMPORT) que ainda não possui EngineeringChangeLog
 * `changeOrigin=NOMUS_SYNC fieldName="@created"`, grava uma entry retroativa
 * IMPORTED.
 *
 * Cria um EngineeringSyncRun próprio (respeita a FK runId).
 *
 * NÃO altera Product/Material. NÃO toca ProductBOM, custo, preço, proposta
 * ou pedido. Idempotente: rodar 2x não duplica.
 *
 * Uso:
 *   npm run sync:nomus:master-data-history-backfill                                        # dry-run
 *   npm run sync:nomus:master-data-history-backfill -- --confirm="BACKFILL HISTORICO NOMUS"
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  ensureNomusImportHistoryForMaterial,
  ensureNomusImportHistoryForProduct,
} from "../src/lib/productChangeHistory.ts";

const prisma = new PrismaClient();

const BACKFILL_CONFIRMATION_TEXT = "BACKFILL HISTORICO NOMUS" as const;
const NOMUS_MATERIAL_CATEGORY = "NOMUS_IMPORT";
const NOMUS_SOURCE = "NOMUS";
const BACKFILL_RUN_ORIGIN = "MASTER_DATA_HISTORY_BACKFILL" as const;

function log(msg: string): void {
  console.warn(`[history-backfill] ${msg}`);
}

function parseArgs(): { confirm: string | null } {
  let confirm: string | null = null;
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--confirm=(.+)$/);
    if (m) confirm = m[1];
  }
  return { confirm };
}

type Candidate =
  | { kind: "PRODUCT"; id: string; sku: string; name: string }
  | { kind: "MATERIAL"; id: string; code: string; description: string };

async function loadCandidates(): Promise<{
  products: Array<{ id: string; sku: string; name: string }>;
  materials: Array<{ id: string; code: string; description: string }>;
}> {
  const [productsRaw, materialsRaw] = await Promise.all([
    prisma.product.findMany({
      where: {
        OR: [{ isNomusControlled: true }, { sourceSystem: NOMUS_SOURCE }],
      },
      select: { id: true, sku: true, name: true },
    }),
    prisma.material.findMany({
      where: { category: NOMUS_MATERIAL_CATEGORY },
      select: { id: true, code: true, description: true },
    }),
  ]);
  return { products: productsRaw, materials: materialsRaw };
}

async function listMissingProducts(
  products: Array<{ id: string; sku: string; name: string }>
): Promise<Array<{ id: string; sku: string; name: string }>> {
  if (products.length === 0) return [];
  const productIds = products.map((p) => p.id);
  const existing = await prisma.engineeringChangeLog.findMany({
    where: {
      productId: { in: productIds },
      entityType: "PRODUCT",
      changeOrigin: "NOMUS_SYNC",
    },
    select: { productId: true },
  });
  const hasHistory = new Set(existing.map((e) => e.productId));
  return products.filter((p) => !hasHistory.has(p.id));
}

async function listMissingMaterials(
  materials: Array<{ id: string; code: string; description: string }>
): Promise<Array<{ id: string; code: string; description: string }>> {
  if (materials.length === 0) return [];
  const materialIds = materials.map((m) => m.id);
  const existing = await prisma.engineeringChangeLog.findMany({
    where: {
      entityId: { in: materialIds },
      entityType: "MATERIAL",
      changeOrigin: "NOMUS_SYNC",
    },
    select: { entityId: true },
  });
  const hasHistory = new Set(existing.map((e) => e.entityId));
  return materials.filter((m) => !hasHistory.has(m.id));
}

function buildPlanHash(candidates: Candidate[]): string {
  const fingerprint = candidates
    .map((c) => (c.kind === "PRODUCT" ? `P:${c.id}` : `M:${c.id}`))
    .sort()
    .join("|");
  return createHash("sha1")
    .update(`history-backfill|${fingerprint || "empty"}|${new Date().toISOString().slice(0, 10)}`)
    .digest("hex");
}

async function main(): Promise<void> {
  log("iniciando…");
  const { confirm } = parseArgs();
  const isDryRun = confirm !== BACKFILL_CONFIRMATION_TEXT;

  const { products, materials } = await loadCandidates();
  log(
    `candidatos · Products controlados pelo Nomus=${products.length} · Materials category=NOMUS_IMPORT=${materials.length}`
  );

  const [missingProducts, missingMaterials] = await Promise.all([
    listMissingProducts(products),
    listMissingMaterials(materials),
  ]);
  log(
    `faltam histórico · Products=${missingProducts.length} · Materials=${missingMaterials.length}`
  );

  if (missingProducts.length === 0 && missingMaterials.length === 0) {
    log("Nada a fazer — todos os itens controlados pelo Nomus já possuem histórico IMPORTED.");
    log("status=NO_CHANGES");
    return;
  }

  if (isDryRun) {
    log(
      `dry-run (sem --confirm). Para aplicar, rode novamente com --confirm="${BACKFILL_CONFIRMATION_TEXT}".`
    );
    log("amostra (até 5 Products):");
    for (const p of missingProducts.slice(0, 5)) {
      log(`  PRODUCT ${p.sku} | ${p.name}`);
    }
    log("amostra (até 5 Materials):");
    for (const m of missingMaterials.slice(0, 5)) {
      log(`  MATERIAL ${m.code} | ${m.description}`);
    }
    log(`status=DRY_RUN · seriam criados ${missingProducts.length + missingMaterials.length} registros de histórico.`);
    return;
  }

  // Cria EngineeringSyncRun pai. Sem isso, a FK runId quebra.
  const candidates: Candidate[] = [
    ...missingProducts.map<Candidate>((p) => ({ kind: "PRODUCT", ...p })),
    ...missingMaterials.map<Candidate>((m) => ({ kind: "MATERIAL", ...m })),
  ];
  const planHash = buildPlanHash(candidates);

  const run = await prisma.engineeringSyncRun.create({
    data: {
      mode: "ALL_NOMUS_PRODUCTS",
      status: "PREVIEWED",
      parentCode: null,
      planHash,
      confirmationText: BACKFILL_CONFIRMATION_TEXT,
      approvedBy: "cli-history-backfill",
      startedAt: new Date(),
      summaryJson: {
        origin: BACKFILL_RUN_ORIGIN,
        candidatesCount: candidates.length,
        missingProducts: missingProducts.length,
        missingMaterials: missingMaterials.length,
      } as never,
    },
    select: { id: true },
  });
  const runId = run.id;
  log(`runId=${runId} · planHash=${planHash.slice(0, 12)}…`);

  let createdForProducts = 0;
  let createdForMaterials = 0;
  let errors = 0;
  const errorList: Array<{ kind: string; ref: string; message: string }> = [];

  for (const p of missingProducts) {
    try {
      const res = await ensureNomusImportHistoryForProduct({
        productId: p.id,
        productSku: p.sku,
        runId,
        planHash,
        summary:
          "Backfill retroativo: Product criado pela Carga Mestre Nomus antes da existência do histórico.",
      });
      if (res.created) createdForProducts += 1;
    } catch (err) {
      errors += 1;
      errorList.push({
        kind: "PRODUCT",
        ref: p.sku,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const m of missingMaterials) {
    try {
      const res = await ensureNomusImportHistoryForMaterial({
        materialId: m.id,
        materialCode: m.code,
        runId,
        planHash,
        summary:
          "Backfill retroativo: Material criado pela Carga Mestre Nomus antes da existência do histórico.",
      });
      if (res.created) createdForMaterials += 1;
    } catch (err) {
      errors += 1;
      errorList.push({
        kind: "MATERIAL",
        ref: m.code,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalApplied = createdForProducts + createdForMaterials;
  const statusFinal: "APPLIED" | "PARTIAL" | "FAILED" =
    errors > 0 && totalApplied === 0
      ? "FAILED"
      : errors > 0
        ? "PARTIAL"
        : "APPLIED";

  try {
    await prisma.engineeringSyncRun.update({
      where: { id: runId },
      data: {
        status: statusFinal,
        finishedAt: new Date(),
        summaryJson: {
          origin: BACKFILL_RUN_ORIGIN,
          candidatesCount: candidates.length,
          createdForProducts,
          createdForMaterials,
          errors,
        } as never,
        errorsJson: errorList.length > 0 ? (errorList as never) : undefined,
      },
    });
  } catch (err) {
    console.error("[history-backfill] falha ao fechar run:", err instanceof Error ? err.message : err);
  }

  log(`status=${statusFinal}`);
  log(`created · Products=${createdForProducts} · Materials=${createdForMaterials}`);
  log(`errors=${errors}`);
  log(`runId=${runId}`);
  for (const e of errorList.slice(0, 10)) {
    log(`  ERR · ${e.kind} ${e.ref} · ${e.message}`);
  }
}

main()
  .catch((err) => {
    console.error("[history-backfill] erro fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
