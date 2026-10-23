/**
 * Compras — Qualidade das Condições de Compra (servidor).
 *
 * Lê o espelho local dos Pedidos de Compra Nomus (parcelas já persistidas em `rawPayload`),
 * em UMA consulta por período com projeção só dos campos necessários (sem N+1, sem chamar o
 * Nomus). Toda a regra fica em `purchasePaymentTermsAnalysis.ts`.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { parsePurchaseOrderPlannedInstallments } from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import { resolvePurchaseOrderSupplierDisplayNames } from "@/src/lib/nomus/nomusPurchaseOrder360.server.js";
import { calendarDateKey } from "./purchasePaymentTerms.js";
import { isNomusOpsExcludeMissingPurchaseOrdersEnabled } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";
import {
  buildPaymentTermsAnalysis,
  buildSupplierPaymentTermsDetail,
  previousPeriod,
  type PaymentTermsOrderInput,
  type PaymentTermsPeriod,
} from "./purchasePaymentTermsAnalysis.js";

type Db = Pick<PrismaClient, "$queryRaw" | "purchasePaymentTermsSettings" | "purchasePaymentTermsSettingsHistory" | "$transaction">;

export const PAYMENT_TERMS_TARGET_MIN = 0;
export const PAYMENT_TERMS_TARGET_MAX = 365;

export type PaymentTermsSettingsDto = {
  targetPmpDays: number | null;
  updatedAt: string | null;
  updatedByUserName: string | null;
};

export async function loadPaymentTermsSettings(db: Pick<Db, "purchasePaymentTermsSettings">): Promise<PaymentTermsSettingsDto> {
  const row = await db.purchasePaymentTermsSettings.findUnique({ where: { id: "GLOBAL" } });
  return {
    targetPmpDays: row?.targetPmpDays ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedByUserName: row?.updatedByUserName ?? null,
  };
}

export function parsePaymentTermsTargetInput(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, value: null };
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < PAYMENT_TERMS_TARGET_MIN || n > PAYMENT_TERMS_TARGET_MAX) {
    return { ok: false, error: `Meta inválida: informe dias inteiros entre ${PAYMENT_TERMS_TARGET_MIN} e ${PAYMENT_TERMS_TARGET_MAX}, ou deixe vazio para remover.` };
  }
  return { ok: true, value: n };
}

/** Grava a meta e o histórico (autoria/data) na mesma transação. Não toca em pedidos. */
export async function updatePaymentTermsTarget(
  db: Pick<Db, "$transaction">,
  actor: { userId: string | null; name: string },
  targetPmpDays: number | null,
): Promise<PaymentTermsSettingsDto> {
  return db.$transaction(async (tx) => {
    const before = await tx.purchasePaymentTermsSettings.findUnique({ where: { id: "GLOBAL" } });
    const row = await tx.purchasePaymentTermsSettings.upsert({
      where: { id: "GLOBAL" },
      create: { id: "GLOBAL", targetPmpDays, updatedByUserId: actor.userId, updatedByUserName: actor.name },
      update: { targetPmpDays, updatedByUserId: actor.userId, updatedByUserName: actor.name },
    });
    await tx.purchasePaymentTermsSettingsHistory.create({
      data: {
        previousTargetDays: before?.targetPmpDays ?? null,
        targetDays: targetPmpDays,
        changedByUserId: actor.userId,
        changedByUserName: actor.name,
      },
    });
    return { targetPmpDays: row.targetPmpDays, updatedAt: row.updatedAt.toISOString(), updatedByUserName: row.updatedByUserName };
  });
}

type ProjectionRow = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  issuedAt: Date | null;
  stage: string;
  canceled: boolean | null;
  totalAmount: Prisma.Decimal | null;
  paymentTerms: string | null;
  parcelas: unknown;
  buyer: string | null;
};

/**
 * Pedidos emitidos no intervalo (com 1 dia de folga nas pontas; o filtro exato é pela data
 * civil de emissão na regra pura). Projeção JSON só de `parcelas` e do comprador.
 */
export async function loadPaymentTermsOrders(
  db: Pick<Db, "$queryRaw">,
  range: { from: string; to: string; supplierExternalId?: number | null },
): Promise<PaymentTermsOrderInput[]> {
  const from = new Date(`${range.from}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${range.to}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 2);
  const supplierFilter =
    range.supplierExternalId != null ? Prisma.sql`AND "supplierExternalId" = ${range.supplierExternalId}` : Prisma.empty;
  // "Ausente no Nomus — confirmado" fora do PMP (flag operacional); em verificação continua contando.
  const presenceFilter = isNomusOpsExcludeMissingPurchaseOrdersEnabled()
    ? Prisma.sql`AND "sourcePresenceStatus" <> 'MISSING_CONFIRMED'`
    : Prisma.empty;
  const rows = await db.$queryRaw<ProjectionRow[]>`
    SELECT "id", "externalId", "orderNumber", "supplierExternalId", "supplierName", "supplierTaxId",
           "issuedAt", "stage", "canceled", "totalAmount", "paymentTerms",
           "rawPayload"->'parcelas' AS "parcelas",
           "rawPayload"->>'idPessoaComprador' AS "buyer"
    FROM "NomusPurchaseOrder"
    WHERE "issuedAt" >= ${from} AND "issuedAt" < ${to} ${supplierFilter} ${presenceFilter}`;
  const names = await resolvePurchaseOrderSupplierDisplayNames(rows);
  return rows.map((r) => {
    const buyer = r.buyer != null && /^-?\d+$/.test(r.buyer.trim()) ? Number(r.buyer.trim()) : null;
    const key = r.supplierExternalId != null ? String(r.supplierExternalId) : `name:${r.supplierName ?? ""}`;
    return {
      id: r.id,
      externalId: Number(r.externalId),
      orderNumber: r.orderNumber,
      supplierExternalId: r.supplierExternalId != null ? Number(r.supplierExternalId) : null,
      supplierName: names.get(key) ?? r.supplierName ?? "Fornecedor não identificado",
      buyerPersonId: buyer,
      issuedDate: r.issuedAt ? calendarDateKey(r.issuedAt) : null,
      stage: r.stage,
      canceled: r.canceled,
      totalAmount: r.totalAmount != null ? Number(r.totalAmount.toString()) : null,
      conditionText: r.paymentTerms,
      installments: parsePurchaseOrderPlannedInstallments({ parcelas: r.parcelas }),
    };
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Período padrão: mês corrente (até hoje). */
export function parsePaymentTermsPeriod(query: Record<string, unknown>, today: Date = new Date()): PaymentTermsPeriod | { error: string } {
  const todayKey = calendarDateKey(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))) as string;
  const from = String(query.from ?? "").trim() || `${todayKey.slice(0, 7)}-01`;
  const to = String(query.to ?? "").trim() || todayKey;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { error: "Período inválido (AAAA-MM-DD)." };
  if (from > to) return { error: "Data inicial maior que a final." };
  return { from, to };
}

export type PaymentTermsScope = { supplierExternalId?: number | null; buyerPersonId?: number | null };

export function parsePaymentTermsScope(query: Record<string, unknown>): PaymentTermsScope {
  const int = (v: unknown) => (/^-?\d+$/.test(String(v ?? "").trim()) ? Number(String(v).trim()) : null);
  return { supplierExternalId: int(query.supplier ?? query.fornecedor), buyerPersonId: int(query.buyer ?? query.comprador) };
}

export async function buildPaymentTermsAnalysisResponse(db: Db, period: PaymentTermsPeriod, scope: PaymentTermsScope = {}) {
  const prev = previousPeriod(period);
  const [settings, loaded] = await Promise.all([
    loadPaymentTermsSettings(db),
    loadPaymentTermsOrders(db, { from: prev?.from ?? period.from, to: period.to, supplierExternalId: scope.supplierExternalId }),
  ]);
  const orders = scope.buyerPersonId != null ? loaded.filter((o) => o.buyerPersonId === scope.buyerPersonId) : loaded;
  return { settings, scope, ...buildPaymentTermsAnalysis({ orders, period, targetDays: settings.targetPmpDays }) };
}

export async function buildSupplierPaymentTermsDetailResponse(db: Db, period: PaymentTermsPeriod, supplierExternalId: number) {
  const [settings, orders] = await Promise.all([
    loadPaymentTermsSettings(db),
    loadPaymentTermsOrders(db, { from: period.from, to: period.to, supplierExternalId }),
  ]);
  return { settings, ...buildSupplierPaymentTermsDetail({ orders, period, targetDays: settings.targetPmpDays, supplierExternalId }) };
}
