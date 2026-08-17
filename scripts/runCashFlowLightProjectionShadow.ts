/**
 * FASE 2C — shadow OLD × NEW com dados reais (diagnóstico, read-only).
 *
 * Compara, por pedido:
 *   OLD  getOrderFullAudit
 *   NEW  loadCashFlowOrderProjections
 * na fronteira financeira que o Fluxo de Caixa consome, e depois o schedule
 * final produzido pelo MESMO motor a partir de cada lado.
 *
 * NÃO é rota HTTP, não é cron, não é chamado pelo servidor. Só leitura:
 * toda a cadeia foi auditada e não contém create/update/upsert/delete,
 * executeRaw/queryRawUnsafe nem cliente HTTP Nomus.
 *
 * PRIVACIDADE: a saída não imprime nome, CNPJ, comentários, rawPayload nem
 * payload completo — só identificadores de pedido e caminhos/valores dos
 * campos financeiros divergentes.
 *
 * Uso:
 *   node node_modules/tsx/dist/cli.mjs scripts/runCashFlowLightProjectionShadow.ts --limit=5
 *   node node_modules/tsx/dist/cli.mjs scripts/runCashFlowLightProjectionShadow.ts --sales-order-id=<id>[,<id>]
 */

import { prisma } from "@/src/lib/prisma.js";
import { getOrderFullAudit } from "@/src/lib/finance/orderFullAuditService.js";
import { loadCashFlowOrderProjections } from "@/src/lib/finance/cashFlowOrderProjectionLoader.server.js";
import { buildEffectiveScheduleInputFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";

export type ShadowDifference = { path: string; old: unknown; neo: unknown };

/** Campos que nunca podem sair no relatório. */
const CAMPOS_SENSIVEIS = new Set([
  "personName",
  "personCnpj",
  "companyName",
  "customerName",
  "comments",
  "description",
  "rawPayload",
  "nomusRawResponse",
  "nomusRawItem",
  "paymentTermsText",
]);

/**
 * Valores que são objetos mas devem ser comparados como escalares.
 *
 * Sem isto, `Prisma.Decimal` seria percorrido campo a campo (comparando
 * representação interna) e `Date` seria percorrido como objeto sem chaves —
 * duas datas diferentes dariam "iguais". Ambos produziriam veredito errado.
 */
function isScalarLike(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  if (value instanceof Date) return true;
  return typeof (value as { toFixed?: unknown }).toFixed === "function";
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isScalarLike(value)
  );
}

/** Diff estrutural, pulando ramos sensíveis. Money entra como está (exato). */
export function diffDeep(
  old: unknown,
  neo: unknown,
  path = "",
  out: ShadowDifference[] = []
): ShadowDifference[] {
  if (old === neo) return out;

  if (Array.isArray(old) || Array.isArray(neo)) {
    const a = Array.isArray(old) ? old : [];
    const b = Array.isArray(neo) ? neo : [];
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, old: a.length, neo: b.length });
    }
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      diffDeep(a[i], b[i], `${path}[${i}]`, out);
    }
    return out;
  }

  if (isPlain(old) || isPlain(neo)) {
    const a = isPlain(old) ? old : {};
    const b = isPlain(neo) ? neo : {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (CAMPOS_SENSIVEIS.has(key)) continue;
      diffDeep(a[key], b[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }

  const norm = (v: unknown) =>
    v instanceof Date
      ? v.toISOString()
      : isScalarLike(v)
        ? String(v)
        : v != null && typeof v === "object" && "toString" in v
          ? String(v)
          : v;
  if (norm(old) !== norm(neo)) out.push({ path, old: norm(old), neo: norm(neo) });
  return out;
}

/** Fronteira financeira consumida pelo cash-flow — só ela é comparada. */
export function projectComparableBoundary(input: {
  salesOrderId: string;
  orderCode: string | null;
  items: ReadonlyArray<Record<string, unknown>>;
  stockDocuments: ReadonlyArray<Record<string, unknown>>;
  receivables: ReadonlyArray<Record<string, unknown>>;
  plannedReceivables: ReadonlyArray<Record<string, unknown>>;
}) {
  return {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode,
    items: input.items.map((i) => ({
      salesOrderItemId: i.salesOrderItemId,
      totalNetValue: i.totalNetValue,
      activeValue: i.activeValue,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      nomusItemStatusRaw: i.nomusItemStatusRaw,
      nomusItemStatusNormalized: i.nomusItemStatusNormalized,
      nomusQuantityFulfilled: i.nomusQuantityFulfilled,
      nomusIsCut: i.nomusIsCut,
      nomusIsCanceled: i.nomusIsCanceled,
      nomusIsStale: i.nomusIsStale,
    })),
    stockDocuments: input.stockDocuments.map((d) => ({
      stockDocumentExternalId: d.stockDocumentExternalId,
      idNfe: d.idNfe,
      status: d.status,
      dataDocumento: d.dataDocumento,
      dataMovimentacao: d.dataMovimentacao,
      allocatedValue: d.allocatedValue,
    })),
    receivables: input.receivables.map((r) => ({
      receivableExternalId: r.receivableExternalId,
      sourceInvoiceId: r.sourceInvoiceId,
      dueDate: r.dueDate,
      amountReceivable: r.amountReceivable,
      amountReceived: r.amountReceived,
      balanceReceivable: r.balanceReceivable,
      status: r.status,
    })),
    plannedReceivables: input.plannedReceivables.map((p) => ({
      key: p.key,
      installmentNumber: p.installmentNumber,
      dueDate: p.dueDate,
      expectedAmount: p.expectedAmount,
      openAmount: p.openAmount,
      statusLabel: p.statusLabel,
      entryKind: p.entryKind,
      replacedByRealCr: p.replacedByRealCr,
    })),
  };
}

/** Recorte do schedule que decide o número exibido. */
export function comparableSchedule(schedule: Record<string, unknown>) {
  return {
    activeOrderResidualSchedule: schedule.activeOrderResidualSchedule,
    supersededOrderSchedule: schedule.supersededOrderSchedule,
    coverageSummary: schedule.coverageSummary,
    realReceivables: schedule.realReceivables,
  };
}

export type ShadowOrderResult = {
  salesOrderId: string;
  level1: ShadowDifference[];
  level2: ShadowDifference[];
  skipped?: string;
};

function parseArgs(argv: string[]) {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
  const ids = get("sales-order-id");
  return {
    salesOrderIds: ids ? ids.split(",").map((s) => s.trim()).filter(Boolean) : [],
    limit: Number(get("limit") ?? 5),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const referenceDate = new Date();

  const ids =
    args.salesOrderIds.length > 0
      ? args.salesOrderIds
      : (
          await prisma.salesOrder.findMany({
            where: { nfeLinks: { some: {} } },
            select: { id: true },
            orderBy: { issueDate: "desc" },
            take: Math.max(1, args.limit),
          })
        ).map((o) => o.id);

  if (ids.length === 0) {
    console.info("[shadow] nenhum pedido selecionado.");
    return 0;
  }

  const light = await loadCashFlowOrderProjections(prisma, {
    salesOrderIds: ids,
    referenceDate,
  });

  const results: ShadowOrderResult[] = [];
  for (const salesOrderId of ids) {
    const audit = await getOrderFullAudit({ salesOrderId });
    if (!("ok" in audit) || audit.ok !== true) {
      results.push({ salesOrderId, level1: [], level2: [], skipped: "audit-falhou" });
      continue;
    }
    const neo = light.get(salesOrderId);
    if (!neo) {
      results.push({ salesOrderId, level1: [], level2: [], skipped: "sem-projecao" });
      continue;
    }

    const a = audit as unknown as Record<string, unknown>;
    const level1 = diffDeep(
      projectComparableBoundary({
        salesOrderId: String(a.salesOrderId),
        orderCode: (a.orderCode as string | null) ?? null,
        items: a.items as never,
        stockDocuments: a.stockDocuments as never,
        receivables: a.receivables as never,
        plannedReceivables: a.plannedReceivables as never,
      }),
      projectComparableBoundary(neo as never)
    );

    const oldSchedule = buildSalesOrderEffectiveFinancialSchedule(
      buildEffectiveScheduleInputFromAudit(audit as never, referenceDate)
    );
    const newSchedule = buildSalesOrderEffectiveFinancialSchedule(
      buildEffectiveScheduleInputFromAudit(
        {
          salesOrderId: neo.salesOrderId,
          orderCode: neo.orderCode,
          salesOrder: { orderCode: neo.orderCode },
          items: neo.items,
          receivables: neo.receivables,
          stockDocuments: neo.stockDocuments,
          stockDocumentItems: [],
          plannedReceivables: neo.plannedReceivables,
        } as never,
        referenceDate
      )
    );
    const level2 = diffDeep(
      comparableSchedule(oldSchedule as never),
      comparableSchedule(newSchedule as never)
    );

    results.push({ salesOrderId, level1, level2 });
  }

  let falhas = 0;
  for (const r of results) {
    if (r.skipped) {
      console.info(`${r.salesOrderId} skipped=${r.skipped}`);
      continue;
    }
    const ok1 = r.level1.length === 0;
    const ok2 = r.level2.length === 0;
    if (!ok1 || !ok2) falhas += 1;
    console.info(
      `${r.salesOrderId} shadowLevel1=${ok1 ? "OK" : "FAIL"} shadowLevel2=${ok2 ? "OK" : "FAIL"} differences=${r.level1.length + r.level2.length}`
    );
    for (const d of [...r.level1, ...r.level2].slice(0, 20)) {
      console.info(`   ${d.path}  old=${JSON.stringify(d.old)}  new=${JSON.stringify(d.neo)}`);
    }
  }

  console.info(
    `[shadow] pedidos=${results.length} divergentes=${falhas} referenceDate=${referenceDate.toISOString()}`
  );
  return falhas > 0 ? 1 : 0;
}

const invocadoDiretamente = (process.argv[1] ?? "").includes(
  "runCashFlowLightProjectionShadow"
);
if (invocadoDiretamente) {
  main()
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (error) => {
      console.error("[shadow] erro:", error);
      await prisma.$disconnect();
      process.exit(2);
    });
}
