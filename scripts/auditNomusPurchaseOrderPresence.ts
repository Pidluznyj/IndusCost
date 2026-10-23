/**
 * Auditoria SOMENTE LEITURA da presença de um Pedido de Compra Nomus (caso PC00637 / ID Nomus 638).
 *
 *   tsx scripts/auditNomusPurchaseOrderPresence.ts --external-id=638
 *       [--nomus-lookup]   GET pedidoscompra/{id} no Nomus (leitura; 404 nunca é tratado como prova)
 *       [--nomus-scan]     varredura completa da listagem no Nomus (leitura; nada é gravado)
 *       [--show-amounts]   inclui totais financeiros na saída (padrão: ocultos)
 *
 * Nunca grava no banco nem no Nomus: só findUnique/findMany/count e GET.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildNomusUrl, fetchNomusJson } from "@/src/lib/nomusRestClient.js";
import { mapNomusPurchaseOrderPayload } from "@/src/lib/nomus/nomusPurchaseOrderMapper.js";
import {
  NOMUS_PURCHASE_ORDER_RESOURCE,
  buildPurchaseOrderPageParams,
  hasNextPurchaseOrderPage,
  pickPurchaseOrderPageItems,
  resolvePurchaseOrderPageSize,
} from "@/src/lib/nomus/nomusPurchaseOrderSyncLogic.js";
import {
  lookupNomusPurchaseOrderById,
  resolvePurchaseOrderSyncFlags,
  sanitizePurchaseOrderSyncError,
} from "@/src/lib/nomus/nomusPurchaseOrderSyncService.server.js";
import {
  parsePurchaseOrderPlannedInstallments,
  sumPlannedInstallmentsTotal,
} from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import { isCountableSuccess } from "@/src/lib/nomus/nomusPurchaseOrderSyncHealth.js";

export type PurchaseOrderPresenceAuditArgs = {
  externalId: number;
  nomusLookup: boolean;
  nomusScan: boolean;
  showAmounts: boolean;
};

export function parsePurchaseOrderPresenceAuditArgs(argv: string[]): PurchaseOrderPresenceAuditArgs {
  const raw = argv.find((a) => a.startsWith("--external-id="))?.slice("--external-id=".length) ?? "638";
  const externalId = Number.parseInt(raw, 10);
  if (!Number.isFinite(externalId) || externalId <= 0) throw new Error(`--external-id inválido: ${raw}`);
  return {
    externalId,
    nomusLookup: argv.includes("--nomus-lookup"),
    nomusScan: argv.includes("--nomus-scan"),
    showAmounts: argv.includes("--show-amounts"),
  };
}

/** Diagnóstico textual (puro) a partir do estado local e das execuções. */
export function diagnosePurchaseOrderPresence(input: {
  order: {
    stage: string;
    sourcePresenceStatus: string;
    lastSeenAt: Date;
    missingConsecutiveRuns: number;
  } | null;
  lastCompleteFullRun: { startedAt: Date; status: string; payloadComplete: boolean } | null;
  absenceReconciliationEnabled: boolean;
  previewOnly: boolean;
}): string[] {
  const out: string[] = [];
  if (!input.order) {
    out.push("Pedido não existe no espelho local (nunca sincronizado ou externalId incorreto).");
    return out;
  }
  const o = input.order;
  out.push(`Estado local: fase ${o.stage}, presença ${o.sourcePresenceStatus}, visto pela última vez em ${o.lastSeenAt.toISOString()}.`);
  if (o.sourcePresenceStatus === "PRESENT" && input.lastCompleteFullRun && o.lastSeenAt < input.lastCompleteFullRun.startedAt) {
    out.push(
      "Não apareceu na última varredura completa, mas a presença não foi alterada: a reconciliação de ausências não gravou (desligada ou só-prévia)."
    );
  }
  if (!input.lastCompleteFullRun) {
    out.push(
      "Nenhuma varredura completa (FULL_RECONCILIATION SUCCESS + payload completo) registrada: o incremental só faz upsert de quem a API devolve e nunca remove — por isso um pedido excluído no Nomus continua com a última fase conhecida (ex.: Aprovado)."
    );
  }
  if (!input.absenceReconciliationEnabled) out.push("Reconciliação de ausências desligada (NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED).");
  else if (input.previewOnly) out.push("Reconciliação em modo só-prévia (NOMUS_PO_RECONCILE_PREVIEW_ONLY=1): ausências só aparecem no resumo do run.");
  if (o.sourcePresenceStatus === "MISSING_CANDIDATE") out.push(`Em verificação: ${o.missingConsecutiveRuns} varredura(s) completa(s) sem o pedido.`);
  if (o.sourcePresenceStatus === "MISSING_CONFIRMED") out.push("Ausência confirmada: fora da carteira padrão; histórico, itens e vínculos preservados.");
  return out;
}

async function main() {
  const args = parsePurchaseOrderPresenceAuditArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const flags = resolvePurchaseOrderSyncFlags(process.env);
  const report: Record<string, unknown> = { externalId: args.externalId, readOnly: true, generatedAt: new Date().toISOString() };

  try {
    const order = await prisma.nomusPurchaseOrder.findUnique({
      where: { externalId: args.externalId },
      select: {
        id: true,
        externalId: true,
        orderNumber: true,
        supplierName: true,
        supplierTaxId: true,
        statusRaw: true,
        canceled: true,
        stage: true,
        issuedAt: true,
        totalAmount: true,
        rawPayload: true,
        syncedAt: true,
        firstSeenAt: true,
        lastSeenAt: true,
        sourcePresenceStatus: true,
        presentInLastPayload: true,
        missingSince: true,
        missingConsecutiveRuns: true,
        sourceRemovedAt: true,
        lastSyncRunId: true,
        _count: { select: { items: true, payableLinks: true, presenceEvents: true } },
        supplierEvaluation: { select: { id: true } },
      },
    });

    if (order) {
      const installments = parsePurchaseOrderPlannedInstallments(order.rawPayload);
      const plannedTotal = sumPlannedInstallmentsTotal(installments);
      report.order = {
        id: order.id,
        orderNumber: order.orderNumber,
        supplierName: order.supplierName,
        supplierTaxId: order.supplierTaxId,
        statusRaw: order.statusRaw,
        canceled: order.canceled,
        stage: order.stage,
        issuedAt: order.issuedAt?.toISOString() ?? null,
        syncedAt: order.syncedAt.toISOString(),
        firstSeenAt: order.firstSeenAt.toISOString(),
        lastSeenAt: order.lastSeenAt.toISOString(),
        presence: {
          sourcePresenceStatus: order.sourcePresenceStatus,
          presentInLastPayload: order.presentInLastPayload,
          missingSince: order.missingSince?.toISOString() ?? null,
          missingConsecutiveRuns: order.missingConsecutiveRuns,
          sourceRemovedAt: order.sourceRemovedAt?.toISOString() ?? null,
          lastSyncRunId: order.lastSyncRunId,
        },
        preserved: {
          items: order._count.items,
          payableLinks: order._count.payableLinks,
          supplierEvaluation: order.supplierEvaluation != null,
          plannedInstallments: installments.length,
          presenceEvents: order._count.presenceEvents,
        },
        ...(args.showAmounts
          ? { amounts: { totalAmount: order.totalAmount?.toString() ?? null, plannedInstallmentsTotal: plannedTotal?.toFixed(2) ?? null } }
          : {}),
      };
      report.presenceEvents = await prisma.nomusPurchaseOrderPresenceEvent.findMany({
        where: { purchaseOrderId: order.id },
        orderBy: { occurredAt: "asc" },
        select: { action: true, fromStatus: true, toStatus: true, reason: true, occurredAt: true, syncRunId: true },
      });
    } else {
      report.order = null;
    }

    const runs = await prisma.nomusSourceSyncRun.findMany({
      where: { entityType: "PURCHASE_ORDER" },
      orderBy: { startedAt: "desc" },
      take: 15,
      select: { id: true, status: true, strategy: true, startedAt: true, finishedAt: true, payloadComplete: true, rowsRead: true, pagesRead: true },
    });
    report.recentRuns = runs;
    const lastCompleteFullRun =
      runs.find((r) => r.strategy === "FULL_RECONCILIATION" && isCountableSuccess(r) && r.payloadComplete) ?? null;
    report.diagnosis = diagnosePurchaseOrderPresence({
      order: order
        ? {
            stage: order.stage,
            sourcePresenceStatus: order.sourcePresenceStatus,
            lastSeenAt: order.lastSeenAt,
            missingConsecutiveRuns: order.missingConsecutiveRuns,
          }
        : null,
      lastCompleteFullRun,
      absenceReconciliationEnabled: flags.absenceReconciliationEnabled,
      previewOnly: flags.previewOnly,
    });

    const baseUrl = (process.env.NOMUS_BASE_URL ?? "").trim();
    if ((args.nomusLookup || args.nomusScan) && !baseUrl) throw new Error("NOMUS_BASE_URL ausente para consulta ao Nomus.");

    if (args.nomusLookup) {
      // trust404=false: aqui 404 é só um dado a registrar, nunca prova de exclusão.
      const lookup = await lookupNomusPurchaseOrderById({
        deps: { fetchJson: fetchNomusJson },
        baseUrl,
        externalId: args.externalId,
        trust404: false,
      });
      report.nomusLookup =
        lookup.status === "found"
          ? { status: "found", stage: lookup.row?.stage ?? null, statusRaw: lookup.row?.statusRaw ?? null }
          : lookup;
    }

    if (args.nomusScan) {
      const pageSize = resolvePurchaseOrderPageSize(process.env);
      const maxPages = flags.reconcileMaxPages;
      let pages = 0;
      let records = 0;
      let foundInList = false;
      let drained = false;
      let error: string | null = null;
      try {
        for (let page = 1; page <= maxPages; page += 1) {
          const payload = await fetchNomusJson(
            buildNomusUrl(baseUrl, NOMUS_PURCHASE_ORDER_RESOURCE, buildPurchaseOrderPageParams(page, pageSize)),
            { logPrefix: "[nomus-po-audit]" }
          );
          const items = pickPurchaseOrderPageItems(payload);
          pages += 1;
          records += items.length;
          for (const item of items) {
            const mapped = mapNomusPurchaseOrderPayload(item);
            if (mapped.ok && (mapped as { row: { externalId: number } }).row.externalId === args.externalId) foundInList = true;
          }
          if (items.length === 0 || !hasNextPurchaseOrderPage(payload, page, items.length, pageSize)) {
            drained = true;
            break;
          }
        }
      } catch (e) {
        error = sanitizePurchaseOrderSyncError(e);
      }
      report.nomusScan = { pages, records, drained, foundInList, error, conclusive: drained && !error };
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/auditNomusPurchaseOrderPresence.ts");
if (invokedDirectly) {
  main().catch((error) => {
    console.error("[nomus-po-audit] falha:", sanitizePurchaseOrderSyncError(error));
    process.exit(1);
  });
}
