/**
 * Serviço oficial — apuração (B), guias (C), alocação gerencial (D).
 * Fonte oficial do pago: NomusAccountsPayable quando vinculado; senão amountPaid manual + comprovante.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildFiscalGuideDedupeKey,
  computeFiscalAmountDue,
  computeFiscalBalanceDue,
  FISCAL_GUIDE_STATUS_LABELS,
  FISCAL_GUIDE_TYPE_LABELS,
  resolveFiscalGuideStatus,
  type FiscalAllocationDto,
  type FiscalAllocationMethodCode,
  type FiscalApurationLineDto,
  type FiscalApurationPeriodDto,
  type FiscalGuideStatusCode,
  type FiscalGuideTypeCode,
  type FiscalJurisdictionCode,
  type FiscalPaymentGuideDto,
  type FiscalPaymentProofDto,
} from "./fiscalSettlementClient.js";

type PrismaLike = PrismaClient;

export type ActorCtx = {
  userId?: string | null;
  userName?: string | null;
};

function money(n: number | null | undefined): Prisma.Decimal {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  return new Prisma.Decimal(v.toFixed(2));
}

function dec(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function parseDateOnly(value: string): Date {
  const d = value.slice(0, 10);
  return new Date(`${d}T00:00:00.000Z`);
}

async function audit(
  prisma: PrismaLike,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
    actor?: ActorCtx | null;
  }
): Promise<void> {
  await prisma.fiscalSettlementAuditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson:
        input.before == null
          ? Prisma.JsonNull
          : (input.before as Prisma.InputJsonValue),
      afterJson:
        input.after == null
          ? Prisma.JsonNull
          : (input.after as Prisma.InputJsonValue),
      userId: input.actor?.userId ?? null,
      userName: input.actor?.userName ?? null,
    },
  });
}

function mapLine(row: {
  id: string;
  periodId: string;
  taxType: string;
  nature: string;
  revenueCode: string | null;
  assessedAmount: unknown;
  creditsAmount: unknown;
  compensationsAmount: unknown;
  interestAmount: unknown;
  fineAmount: unknown;
  amountDue: unknown;
  notes: string | null;
  source: string;
}): FiscalApurationLineDto {
  return {
    id: row.id,
    periodId: row.periodId,
    taxType: row.taxType,
    nature: row.nature,
    revenueCode: row.revenueCode,
    assessedAmount: dec(row.assessedAmount),
    creditsAmount: dec(row.creditsAmount),
    compensationsAmount: dec(row.compensationsAmount),
    interestAmount: dec(row.interestAmount),
    fineAmount: dec(row.fineAmount),
    amountDue: dec(row.amountDue),
    notes: row.notes,
    source: row.source,
  };
}

function mapProof(row: {
  id: string;
  guideId: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  notes: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;
}): FiscalPaymentProofDto {
  return {
    id: row.id,
    guideId: row.guideId,
    fileName: row.fileName,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    storageKey: row.storageKey,
    notes: row.notes,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

function mapAllocation(row: {
  id: string;
  guideId: string;
  salesOrderId: string | null;
  nomusNfeId: string | null;
  taxType: string;
  allocatedAmount: unknown;
  allocationMethod: string;
  allocationBase: unknown;
  periodStart: Date | null;
  periodEnd: Date | null;
  calculatedAt: Date;
  version: number;
  manualOverride: boolean;
  notes: string | null;
}): FiscalAllocationDto {
  return {
    id: row.id,
    guideId: row.guideId,
    settlementId: row.guideId,
    salesOrderId: row.salesOrderId,
    nomusNfeId: row.nomusNfeId,
    taxType: row.taxType,
    allocatedAmount: dec(row.allocatedAmount),
    allocationMethod: row.allocationMethod as FiscalAllocationMethodCode,
    allocationBase: row.allocationBase == null ? null : dec(row.allocationBase),
    periodStart: isoDate(row.periodStart),
    periodEnd: isoDate(row.periodEnd),
    calculatedAt: row.calculatedAt.toISOString(),
    version: row.version,
    manualOverride: row.manualOverride,
    notes: row.notes,
    isManagerialOnly: true,
  };
}

function mapGuide(
  row: {
    id: string;
    periodId: string | null;
    taxType: string;
    jurisdiction: string;
    revenueCode: string | null;
    guideType: string;
    guideNumber: string | null;
    barcode: string | null;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date | null;
    assessedAmount: unknown;
    creditsAmount: unknown;
    compensationsAmount: unknown;
    interestAmount: unknown;
    fineAmount: unknown;
    amountDue: unknown;
    amountPaid: unknown;
    balanceDue: unknown;
    paidAt: Date | null;
    status: string;
    paymentAccount: string | null;
    accountsPayableExternalId: number | null;
    costCenterId: string | null;
    dedupeKey: string | null;
    source: string;
    notes: string | null;
    cancelledAt: Date | null;
    proofs?: Array<Parameters<typeof mapProof>[0]>;
    allocations?: Array<Parameters<typeof mapAllocation>[0]>;
  },
  ap: FiscalPaymentGuideDto["accountsPayable"] = null
): FiscalPaymentGuideDto {
  const guideType = row.guideType as FiscalGuideTypeCode;
  const status = row.status as FiscalGuideStatusCode;
  const allocations = (row.allocations ?? []).map(mapAllocation);
  return {
    id: row.id,
    periodId: row.periodId,
    taxType: row.taxType,
    jurisdiction: row.jurisdiction as FiscalJurisdictionCode,
    revenueCode: row.revenueCode,
    guideType,
    guideTypeLabel: FISCAL_GUIDE_TYPE_LABELS[guideType] ?? guideType,
    guideNumber: row.guideNumber,
    barcode: row.barcode,
    periodStart: isoDate(row.periodStart)!,
    periodEnd: isoDate(row.periodEnd)!,
    dueDate: isoDate(row.dueDate),
    assessedAmount: dec(row.assessedAmount),
    creditsAmount: dec(row.creditsAmount),
    compensationsAmount: dec(row.compensationsAmount),
    interestAmount: dec(row.interestAmount),
    fineAmount: dec(row.fineAmount),
    amountDue: dec(row.amountDue),
    amountPaid: dec(row.amountPaid),
    balanceDue: dec(row.balanceDue),
    paidAt: iso(row.paidAt),
    status,
    statusLabel: FISCAL_GUIDE_STATUS_LABELS[status] ?? status,
    paymentAccount: row.paymentAccount,
    accountsPayableExternalId: row.accountsPayableExternalId,
    accountsPayable: ap,
    costCenterId: row.costCenterId,
    dedupeKey: row.dedupeKey,
    source: row.source,
    notes: row.notes,
    cancelledAt: iso(row.cancelledAt),
    proofs: (row.proofs ?? []).map(mapProof),
    allocations,
    allocatedTotal: round2(
      allocations.reduce((s, a) => s + a.allocatedAmount, 0)
    ),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function amountsFromInput(input: {
  assessedAmount?: number;
  creditsAmount?: number;
  compensationsAmount?: number;
  interestAmount?: number;
  fineAmount?: number;
  amountPaid?: number;
}) {
  const assessedAmount = Math.max(0, input.assessedAmount ?? 0);
  const creditsAmount = Math.max(0, input.creditsAmount ?? 0);
  const compensationsAmount = Math.max(0, input.compensationsAmount ?? 0);
  const interestAmount = Math.max(0, input.interestAmount ?? 0);
  const fineAmount = Math.max(0, input.fineAmount ?? 0);
  const amountDue = computeFiscalAmountDue({
    assessedAmount,
    creditsAmount,
    compensationsAmount,
    interestAmount,
    fineAmount,
  });
  const amountPaid = Math.max(0, input.amountPaid ?? 0);
  const balanceDue = computeFiscalBalanceDue(amountDue, amountPaid);
  return {
    assessedAmount,
    creditsAmount,
    compensationsAmount,
    interestAmount,
    fineAmount,
    amountDue,
    amountPaid,
    balanceDue,
  };
}

export async function listFiscalApurationPeriods(
  prisma: PrismaLike,
  filters?: { status?: string | null; limit?: number }
): Promise<FiscalApurationPeriodDto[]> {
  const rows = await prisma.fiscalApurationPeriod.findMany({
    where: filters?.status ? { status: filters.status as never } : undefined,
    include: { lines: { orderBy: { taxType: "asc" } } },
    orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    take: filters?.limit ?? 100,
  });
  return rows.map((p) => {
    const lines = p.lines.map(mapLine);
    return {
      id: p.id,
      companyName: p.companyName,
      jurisdiction: p.jurisdiction as FiscalJurisdictionCode,
      uf: p.uf,
      periodStart: isoDate(p.periodStart)!,
      periodEnd: isoDate(p.periodEnd)!,
      status: p.status,
      notes: p.notes,
      source: p.source,
      closedAt: iso(p.closedAt),
      lines,
      totals: {
        assessedAmount: round2(lines.reduce((s, l) => s + l.assessedAmount, 0)),
        creditsAmount: round2(lines.reduce((s, l) => s + l.creditsAmount, 0)),
        compensationsAmount: round2(
          lines.reduce((s, l) => s + l.compensationsAmount, 0)
        ),
        interestAmount: round2(lines.reduce((s, l) => s + l.interestAmount, 0)),
        fineAmount: round2(lines.reduce((s, l) => s + l.fineAmount, 0)),
        amountDue: round2(lines.reduce((s, l) => s + l.amountDue, 0)),
      },
    };
  });
}

export async function createFiscalApurationPeriod(
  prisma: PrismaLike,
  input: {
    companyName?: string | null;
    jurisdiction: FiscalJurisdictionCode;
    uf?: string | null;
    periodStart: string;
    periodEnd: string;
    notes?: string | null;
    source?: string;
    lines?: Array<{
      taxType: string;
      nature: string;
      revenueCode?: string | null;
      assessedAmount?: number;
      creditsAmount?: number;
      compensationsAmount?: number;
      interestAmount?: number;
      fineAmount?: number;
      notes?: string | null;
    }>;
  },
  actor?: ActorCtx | null
): Promise<FiscalApurationPeriodDto> {
  if (parseDateOnly(input.periodEnd) < parseDateOnly(input.periodStart)) {
    throw Object.assign(new Error("periodEnd deve ser >= periodStart."), {
      status: 400,
    });
  }

  const created = await prisma.fiscalApurationPeriod.create({
    data: {
      companyName: input.companyName?.trim() || null,
      jurisdiction: input.jurisdiction,
      uf: input.uf?.trim()?.toUpperCase() || null,
      periodStart: parseDateOnly(input.periodStart),
      periodEnd: parseDateOnly(input.periodEnd),
      notes: input.notes ?? null,
      source: input.source ?? "MANUAL",
      createdByUserId: actor?.userId ?? null,
      createdByName: actor?.userName ?? null,
      lines: {
        create: (input.lines ?? []).map((l) => {
          const a = amountsFromInput(l);
          return {
            taxType: l.taxType.trim().toUpperCase(),
            nature: l.nature as never,
            revenueCode: l.revenueCode?.trim() || null,
            assessedAmount: money(a.assessedAmount),
            creditsAmount: money(a.creditsAmount),
            compensationsAmount: money(a.compensationsAmount),
            interestAmount: money(a.interestAmount),
            fineAmount: money(a.fineAmount),
            amountDue: money(a.amountDue),
            notes: l.notes ?? null,
            source: input.source ?? "MANUAL",
          };
        }),
      },
    },
    include: { lines: true },
  });

  await audit(prisma, {
    entityType: "FiscalApurationPeriod",
    entityId: created.id,
    action: "CREATE",
    after: created,
    actor,
  });

  const listed = await listFiscalApurationPeriods(prisma, { limit: 200 });
  return listed.find((p) => p.id === created.id)!;
}

export async function closeFiscalApurationPeriod(
  prisma: PrismaLike,
  periodId: string,
  actor?: ActorCtx | null
): Promise<FiscalApurationPeriodDto> {
  const existing = await prisma.fiscalApurationPeriod.findUnique({
    where: { id: periodId },
  });
  if (!existing) {
    throw Object.assign(new Error("Apuração não encontrada."), { status: 404 });
  }
  if (existing.status === "CANCELLED") {
    throw Object.assign(new Error("Apuração cancelada não pode ser fechada."), {
      status: 400,
    });
  }
  const updated = await prisma.fiscalApurationPeriod.update({
    where: { id: periodId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: actor?.userId ?? null,
    },
    include: { lines: true },
  });
  await audit(prisma, {
    entityType: "FiscalApurationPeriod",
    entityId: periodId,
    action: "CLOSE",
    before: existing,
    after: updated,
    actor,
  });
  const listed = await listFiscalApurationPeriods(prisma, { limit: 200 });
  return listed.find((p) => p.id === periodId)!;
}

async function loadApMap(
  prisma: PrismaLike,
  externalIds: number[]
): Promise<Map<number, FiscalPaymentGuideDto["accountsPayable"]>> {
  const ids = [...new Set(externalIds.filter((n) => Number.isFinite(n)))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.nomusAccountsPayable.findMany({
    where: { externalId: { in: ids } },
    select: {
      externalId: true,
      documentNumber: true,
      personName: true,
      amountPaid: true,
      balancePayable: true,
      paymentDate: true,
      settlementDate: true,
    },
  });
  return new Map(
    rows.map((r) => [
      r.externalId,
      {
        externalId: r.externalId,
        documentNumber: r.documentNumber,
        personName: r.personName,
        amountPaid: r.amountPaid == null ? null : dec(r.amountPaid),
        balancePayable: r.balancePayable == null ? null : dec(r.balancePayable),
        paymentDate: iso(r.paymentDate),
        settlementDate: iso(r.settlementDate),
      },
    ])
  );
}

const guideInclude = {
  proofs: { orderBy: { uploadedAt: "desc" as const } },
  allocations: { orderBy: { createdAt: "desc" as const } },
};

export async function listFiscalPaymentGuides(
  prisma: PrismaLike,
  filters?: { status?: string | null; limit?: number }
): Promise<FiscalPaymentGuideDto[]> {
  const rows = await prisma.fiscalPaymentGuide.findMany({
    where: filters?.status ? { status: filters.status as never } : undefined,
    include: guideInclude,
    orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
    take: filters?.limit ?? 200,
  });
  const apMap = await loadApMap(
    prisma,
    rows
      .map((r) => r.accountsPayableExternalId)
      .filter((n): n is number => n != null)
  );
  return rows.map((r) =>
    mapGuide(
      r,
      r.accountsPayableExternalId != null
        ? apMap.get(r.accountsPayableExternalId) ?? null
        : null
    )
  );
}

export async function createFiscalPaymentGuide(
  prisma: PrismaLike,
  input: {
    periodId?: string | null;
    taxType: string;
    jurisdiction: FiscalJurisdictionCode;
    revenueCode?: string | null;
    guideType: FiscalGuideTypeCode;
    guideNumber?: string | null;
    barcode?: string | null;
    periodStart: string;
    periodEnd: string;
    dueDate?: string | null;
    assessedAmount?: number;
    creditsAmount?: number;
    compensationsAmount?: number;
    interestAmount?: number;
    fineAmount?: number;
    amountPaid?: number;
    paidAt?: string | null;
    paymentAccount?: string | null;
    accountsPayableExternalId?: number | null;
    costCenterId?: string | null;
    notes?: string | null;
    source?: string;
    status?: FiscalGuideStatusCode;
  },
  actor?: ActorCtx | null
): Promise<FiscalPaymentGuideDto> {
  if (parseDateOnly(input.periodEnd) < parseDateOnly(input.periodStart)) {
    throw Object.assign(new Error("periodEnd deve ser >= periodStart."), {
      status: 400,
    });
  }

  const amounts = amountsFromInput(input);
  let amountPaid = amounts.amountPaid;
  let paidAt = input.paidAt ? new Date(input.paidAt) : null;
  let apExternalId = input.accountsPayableExternalId ?? null;

  if (apExternalId != null) {
    const ap = await prisma.nomusAccountsPayable.findUnique({
      where: { externalId: apExternalId },
      select: {
        externalId: true,
        amountPaid: true,
        paymentDate: true,
        settlementDate: true,
      },
    });
    if (!ap) {
      throw Object.assign(
        new Error("Contas a Pagar Nomus não encontrado para o vínculo."),
        { status: 400 }
      );
    }
    // Fonte oficial do pago = AP quando vinculado.
    if (ap.amountPaid != null) {
      amountPaid = dec(ap.amountPaid);
    }
    paidAt = ap.paymentDate ?? ap.settlementDate ?? paidAt;
  }

  const balanceDue = computeFiscalBalanceDue(amounts.amountDue, amountPaid);
  const status = resolveFiscalGuideStatus({
    status: input.status ?? "ISSUED",
    amountDue: amounts.amountDue,
    amountPaid,
  });

  const dedupeKey = buildFiscalGuideDedupeKey({
    guideType: input.guideType,
    guideNumber: input.guideNumber,
    revenueCode: input.revenueCode,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });

  if (dedupeKey) {
    const dup = await prisma.fiscalPaymentGuide.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true },
    });
    if (dup && dup.status !== "CANCELLED" && dup.status !== "REVERSED") {
      throw Object.assign(
        new Error("Guia duplicada (mesmo tipo/número/código/período)."),
        { status: 409 }
      );
    }
  }

  if (input.periodId) {
    const period = await prisma.fiscalApurationPeriod.findUnique({
      where: { id: input.periodId },
      select: { id: true, status: true },
    });
    if (!period) {
      throw Object.assign(new Error("Período de apuração não encontrado."), {
        status: 400,
      });
    }
    if (period.status === "CLOSED") {
      throw Object.assign(
        new Error("Período fechado — não é possível vincular nova guia."),
        { status: 400 }
      );
    }
  }

  const created = await prisma.fiscalPaymentGuide.create({
    data: {
      periodId: input.periodId ?? null,
      taxType: input.taxType.trim().toUpperCase(),
      jurisdiction: input.jurisdiction,
      revenueCode: input.revenueCode?.trim() || null,
      guideType: input.guideType,
      guideNumber: input.guideNumber?.trim() || null,
      barcode: input.barcode?.trim() || null,
      periodStart: parseDateOnly(input.periodStart),
      periodEnd: parseDateOnly(input.periodEnd),
      dueDate: input.dueDate ? parseDateOnly(input.dueDate) : null,
      assessedAmount: money(amounts.assessedAmount),
      creditsAmount: money(amounts.creditsAmount),
      compensationsAmount: money(amounts.compensationsAmount),
      interestAmount: money(amounts.interestAmount),
      fineAmount: money(amounts.fineAmount),
      amountDue: money(amounts.amountDue),
      amountPaid: money(amountPaid),
      balanceDue: money(balanceDue),
      paidAt,
      status,
      paymentAccount: input.paymentAccount?.trim() || null,
      accountsPayableExternalId: apExternalId,
      costCenterId: input.costCenterId ?? null,
      dedupeKey,
      source: apExternalId != null ? "AP_LINK" : (input.source ?? "MANUAL"),
      notes: input.notes ?? null,
      createdByUserId: actor?.userId ?? null,
      createdByName: actor?.userName ?? null,
    },
    include: guideInclude,
  });

  await audit(prisma, {
    entityType: "FiscalPaymentGuide",
    entityId: created.id,
    action: "CREATE",
    after: created,
    actor,
  });

  const list = await listFiscalPaymentGuides(prisma, { limit: 500 });
  return list.find((g) => g.id === created.id)!;
}

export async function registerFiscalGuidePayment(
  prisma: PrismaLike,
  guideId: string,
  input: {
    amountPaid: number;
    paidAt?: string | null;
    paymentAccount?: string | null;
    syncFromAp?: boolean;
  },
  actor?: ActorCtx | null
): Promise<FiscalPaymentGuideDto> {
  const existing = await prisma.fiscalPaymentGuide.findUnique({
    where: { id: guideId },
  });
  if (!existing) {
    throw Object.assign(new Error("Guia não encontrada."), { status: 404 });
  }
  if (existing.status === "CANCELLED") {
    throw Object.assign(new Error("Guia cancelada não aceita pagamento."), {
      status: 400,
    });
  }
  if (existing.status === "REVERSED") {
    throw Object.assign(new Error("Guia estornada não aceita pagamento."), {
      status: 400,
    });
  }

  let amountPaid = Math.max(0, input.amountPaid);
  let paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

  if (input.syncFromAp && existing.accountsPayableExternalId != null) {
    const ap = await prisma.nomusAccountsPayable.findUnique({
      where: { externalId: existing.accountsPayableExternalId },
      select: { amountPaid: true, paymentDate: true, settlementDate: true },
    });
    if (ap?.amountPaid != null) amountPaid = dec(ap.amountPaid);
    paidAt = ap?.paymentDate ?? ap?.settlementDate ?? paidAt;
  }

  const amountDue = dec(existing.amountDue);
  const balanceDue = computeFiscalBalanceDue(amountDue, amountPaid);
  const status = resolveFiscalGuideStatus({
    amountDue,
    amountPaid,
    status: "ISSUED",
  });

  const updated = await prisma.fiscalPaymentGuide.update({
    where: { id: guideId },
    data: {
      amountPaid: money(amountPaid),
      balanceDue: money(balanceDue),
      paidAt: amountPaid > 0.009 ? paidAt : null,
      paymentAccount: input.paymentAccount?.trim() || existing.paymentAccount,
      status,
    },
    include: guideInclude,
  });

  await audit(prisma, {
    entityType: "FiscalPaymentGuide",
    entityId: guideId,
    action: "PAYMENT",
    before: existing,
    after: updated,
    actor,
  });

  const list = await listFiscalPaymentGuides(prisma, { limit: 500 });
  return list.find((g) => g.id === guideId)!;
}

export async function cancelFiscalPaymentGuide(
  prisma: PrismaLike,
  guideId: string,
  actor?: ActorCtx | null
): Promise<FiscalPaymentGuideDto> {
  const existing = await prisma.fiscalPaymentGuide.findUnique({
    where: { id: guideId },
  });
  if (!existing) {
    throw Object.assign(new Error("Guia não encontrada."), { status: 404 });
  }
  const updated = await prisma.fiscalPaymentGuide.update({
    where: { id: guideId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: actor?.userId ?? null,
      balanceDue: money(0),
    },
    include: guideInclude,
  });
  await audit(prisma, {
    entityType: "FiscalPaymentGuide",
    entityId: guideId,
    action: "CANCEL",
    before: existing,
    after: updated,
    actor,
  });
  const list = await listFiscalPaymentGuides(prisma, { limit: 500 });
  return list.find((g) => g.id === guideId)!;
}

export async function reverseFiscalGuidePayment(
  prisma: PrismaLike,
  guideId: string,
  actor?: ActorCtx | null
): Promise<FiscalPaymentGuideDto> {
  const existing = await prisma.fiscalPaymentGuide.findUnique({
    where: { id: guideId },
  });
  if (!existing) {
    throw Object.assign(new Error("Guia não encontrada."), { status: 404 });
  }
  if (existing.status === "CANCELLED") {
    throw Object.assign(new Error("Guia cancelada — use outro fluxo."), {
      status: 400,
    });
  }
  const amountDue = dec(existing.amountDue);
  const updated = await prisma.fiscalPaymentGuide.update({
    where: { id: guideId },
    data: {
      amountPaid: money(0),
      balanceDue: money(amountDue),
      paidAt: null,
      status: "REVERSED",
    },
    include: guideInclude,
  });
  await audit(prisma, {
    entityType: "FiscalPaymentGuide",
    entityId: guideId,
    action: "REVERSE_PAYMENT",
    before: existing,
    after: updated,
    actor,
  });
  const list = await listFiscalPaymentGuides(prisma, { limit: 500 });
  return list.find((g) => g.id === guideId)!;
}

export async function addFiscalPaymentProof(
  prisma: PrismaLike,
  guideId: string,
  input: {
    fileName: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    storageKey: string;
    notes?: string | null;
  },
  actor?: ActorCtx | null
): Promise<FiscalPaymentProofDto> {
  const guide = await prisma.fiscalPaymentGuide.findUnique({
    where: { id: guideId },
    select: { id: true, status: true },
  });
  if (!guide) {
    throw Object.assign(new Error("Guia não encontrada."), { status: 404 });
  }
  const proof = await prisma.fiscalPaymentProof.create({
    data: {
      guideId,
      fileName: input.fileName,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      storageKey: input.storageKey,
      notes: input.notes ?? null,
      uploadedBy: actor?.userId ?? null,
    },
  });
  await audit(prisma, {
    entityType: "FiscalPaymentProof",
    entityId: proof.id,
    action: "CREATE",
    after: proof,
    actor,
  });
  return mapProof(proof);
}

export async function createFiscalAllocation(
  prisma: PrismaLike,
  input: {
    guideId: string;
    salesOrderId?: string | null;
    nomusNfeId?: string | null;
    taxType: string;
    allocatedAmount: number;
    allocationMethod: FiscalAllocationMethodCode;
    allocationBase?: number | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    manualOverride?: boolean;
    notes?: string | null;
  },
  actor?: ActorCtx | null
): Promise<FiscalAllocationDto> {
  if (!input.salesOrderId && !input.nomusNfeId) {
    throw Object.assign(
      new Error("Informe salesOrderId ou nomusNfeId para alocação gerencial."),
      { status: 400 }
    );
  }
  const amount = Math.max(0, input.allocatedAmount);
  if (amount <= 0.009) {
    throw Object.assign(new Error("allocatedAmount deve ser > 0."), {
      status: 400,
    });
  }

  const guide = await prisma.fiscalPaymentGuide.findUnique({
    where: { id: input.guideId },
    include: { allocations: true },
  });
  if (!guide) {
    throw Object.assign(new Error("Guia (settlement) não encontrada."), {
      status: 404,
    });
  }
  if (guide.status === "CANCELLED" || guide.status === "REVERSED") {
    throw Object.assign(
      new Error("Não alocar recolhimento de guia cancelada/estornada."),
      { status: 400 }
    );
  }

  const already = guide.allocations.reduce(
    (s, a) => s + dec(a.allocatedAmount),
    0
  );
  const paid = dec(guide.amountPaid);
  const cap = paid > 0.009 ? paid : dec(guide.amountDue);
  if (already + amount > cap + 0.05) {
    throw Object.assign(
      new Error(
        `Alocação excede o disponível da guia (cap=${cap.toFixed(2)}, já=${already.toFixed(2)}).`
      ),
      { status: 400 }
    );
  }

  if (input.salesOrderId) {
    const so = await prisma.salesOrder.findUnique({
      where: { id: input.salesOrderId },
      select: { id: true },
    });
    if (!so) {
      throw Object.assign(new Error("Pedido de venda não encontrado."), {
        status: 400,
      });
    }
  }
  if (input.nomusNfeId) {
    const nfe = await prisma.nomusNfe.findUnique({
      where: { id: input.nomusNfeId },
      select: { id: true },
    });
    if (!nfe) {
      throw Object.assign(new Error("NF-e não encontrada."), { status: 400 });
    }
  }

  const created = await prisma.fiscalAllocation.create({
    data: {
      guideId: input.guideId,
      salesOrderId: input.salesOrderId ?? null,
      nomusNfeId: input.nomusNfeId ?? null,
      taxType: input.taxType.trim().toUpperCase(),
      allocatedAmount: money(amount),
      allocationMethod: input.allocationMethod,
      allocationBase:
        input.allocationBase == null ? null : money(input.allocationBase),
      periodStart: input.periodStart
        ? parseDateOnly(input.periodStart)
        : guide.periodStart,
      periodEnd: input.periodEnd
        ? parseDateOnly(input.periodEnd)
        : guide.periodEnd,
      manualOverride: Boolean(input.manualOverride),
      notes: input.notes ?? null,
      createdByUserId: actor?.userId ?? null,
      createdByName: actor?.userName ?? null,
    },
  });

  await audit(prisma, {
    entityType: "FiscalAllocation",
    entityId: created.id,
    action: "CREATE",
    after: { ...created, disclaimer: "managerial_only_not_nf_payment" },
    actor,
  });

  return mapAllocation(created);
}

export async function listFiscalAllocationsForOrder(
  prisma: PrismaLike,
  salesOrderId: string
): Promise<FiscalAllocationDto[]> {
  const rows = await prisma.fiscalAllocation.findMany({
    where: { salesOrderId },
    orderBy: { calculatedAt: "desc" },
  });
  return rows.map(mapAllocation);
}
