/**
 * Encerramento de Prestação de Serviço — persistência, preview, comissão (read-only) e export.
 */
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildFormattedLandscapePdf,
  formatPdfMoneyBr,
  formatPdfNumberBr,
  type PdfLine,
} from "@/src/lib/proposalInternalManagementPdfLayout.js";
import {
  calculateServiceTermination,
  formatProportionalRestDaysLabel,
  type ServiceTerminationCalculationMode,
} from "./supplierServiceTerminationCalc.js";
import {
  SERVICE_TERMINATION_PRINT_FOOTER_NOTE,
  buildServiceTerminationPrintModel,
} from "./supplierServiceTerminationPrint.js";
import type { CommissionAccessScope } from "@/src/lib/commissions/commissionAccessScope.js";
import { getCommissionReportsPage } from "@/src/lib/commissions/commissionReports.server.js";
import type {
  CommissionReportsMonthsFilter,
  CommissionReportsQuery,
} from "@/src/lib/commissions/commissionReports.shared.js";
import {
  SERVICE_TERMINATION_AUDIT_ACTIONS,
  SERVICE_TERMINATION_AUDIT_ENTITY,
  type ServiceTerminationCommissionLinkDto,
  type ServiceTerminationCommissionSearchResult,
  type ServiceTerminationDto,
  type ServiceTerminationPreviewInput,
} from "./supplierServiceTerminationTypes.js";

/** Escopo global somente-leitura para o vínculo no encerramento (não altera comissão). */
const TERMINATION_COMMISSION_READ_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

export class SupplierServiceTerminationError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus = 400
  ) {
    super(message);
    this.name = "SupplierServiceTerminationError";
  }
}

function dec(n: Prisma.Decimal | number | null | undefined): number {
  if (n == null) return 0;
  if (typeof n === "number") return Number.isFinite(n) ? n : 0;
  try {
    return n.toNumber();
  } catch {
    return Number(String(n)) || 0;
  }
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseYmd(value: string): Date {
  const t = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new SupplierServiceTerminationError(
      "Data inválida. Use YYYY-MM-DD.",
      "INVALID_DATE"
    );
  }
  const d = new Date(`${t}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new SupplierServiceTerminationError("Data inválida.", "INVALID_DATE");
  }
  return d;
}

async function writeTerminationAudit(input: {
  entityId: string;
  action: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  userId?: string | null;
  userName?: string | null;
}) {
  await prisma.financialCostCenterAuditLog.create({
    data: {
      entityType: SERVICE_TERMINATION_AUDIT_ENTITY,
      entityId: input.entityId,
      action: input.action,
      beforeJson: (input.beforeJson ?? undefined) as object | undefined,
      afterJson: (input.afterJson ?? undefined) as object | undefined,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
    },
  });
}

function commissionsHrefForReport(input: {
  year: number;
  months: CommissionReportsMonthsFilter;
  sellerId: string | "all";
  search?: string | null;
}): string {
  const q = new URLSearchParams();
  q.set("year", String(input.year));
  q.set(
    "months",
    input.months === "all" || (Array.isArray(input.months) && input.months.length === 0)
      ? "all"
      : input.months.join(",")
  );
  q.set("sellerId", input.sellerId || "all");
  if (input.search?.trim()) q.set("search", input.search.trim());
  return `/commissions/reports?${q.toString()}`;
}

function parseMonthsFilter(raw: string | null | undefined): CommissionReportsMonthsFilter {
  if (!raw || raw === "all" || raw.trim() === "") return "all";
  const parts = raw
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  if (parts.length === 0) return "all";
  return [...new Set(parts)].sort((a, b) => a - b);
}

function mapRowToDto(
  row: {
    id: string;
    supplierId: string;
    personName: string;
    personDocument: string | null;
    serviceRole: string | null;
    contractStartDate: Date;
    contractEndDate: Date;
    monthlyServiceAmount: Prisma.Decimal;
    averageWorkedDaysPerMonth?: Prisma.Decimal | null;
    hoursPerDay?: Prisma.Decimal | null;
    monthlyHours: Prisma.Decimal;
    hourlyServiceAmount: Prisma.Decimal;
    dailyServiceAmount: Prisma.Decimal;
    restDaysPerYear: Prisma.Decimal;
    calculationMode: string;
    workedMonths: Prisma.Decimal;
    workedDays: number;
    proportionalRestDays: Prisma.Decimal;
    proportionalRestAmount: Prisma.Decimal;
    extraWorkedDays?: number | null;
    extraWorkedAmount?: Prisma.Decimal | null;
    noticePenaltyAmount?: Prisma.Decimal | null;
    commissionReportId: string | null;
    commissionReportTotal: Prisma.Decimal;
    otherCredits: Prisma.Decimal;
    otherDiscounts: Prisma.Decimal;
    totalTerminationAmount: Prisma.Decimal;
    status: string;
    notes: string | null;
    adjustmentNotes: string | null;
    createdByName: string | null;
    finalizedByName: string | null;
    finalizedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    supplier?: { displayName: string } | null;
    commissionLinks?: Array<{
      id: string;
      commissionReportKey: string;
      commissionPersonId: string | null;
      commissionPersonName: string | null;
      periodLabel: string | null;
      orderCode?: string | null;
      commissionAmount: Prisma.Decimal;
      source: string | null;
      statusLabel: string | null;
    }>;
  }
): ServiceTerminationDto {
  const otherCredits = dec(row.otherCredits);
  const otherDiscounts = dec(row.otherDiscounts);
  const year = row.contractEndDate.getUTCFullYear();
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplier?.displayName ?? "",
    personName: row.personName,
    personDocument: row.personDocument,
    serviceRole: row.serviceRole,
    contractStartDate: toYmd(row.contractStartDate),
    contractEndDate: toYmd(row.contractEndDate),
    monthlyServiceAmount: dec(row.monthlyServiceAmount),
    averageWorkedDaysPerMonth: dec(row.averageWorkedDaysPerMonth) || 30,
    hoursPerDay: dec(row.hoursPerDay) || 8,
    monthlyHours: dec(row.monthlyHours),
    hourlyServiceAmount: dec(row.hourlyServiceAmount),
    dailyServiceAmount: dec(row.dailyServiceAmount),
    restDaysPerYear: dec(row.restDaysPerYear),
    calculationMode: row.calculationMode as ServiceTerminationDto["calculationMode"],
    workedMonths: dec(row.workedMonths),
    workedDays: row.workedDays,
    proportionalRestDays: dec(row.proportionalRestDays),
    proportionalRestAmount: dec(row.proportionalRestAmount),
    extraWorkedDays: row.extraWorkedDays ?? 0,
    extraWorkedAmount: dec(row.extraWorkedAmount),
    noticePenaltyAmount: dec(row.noticePenaltyAmount),
    commissionReportId: row.commissionReportId,
    commissionReportTotal: dec(row.commissionReportTotal),
    otherCredits,
    otherDiscounts,
    otherAdjustments: Math.round((otherCredits - otherDiscounts) * 100) / 100,
    totalTerminationAmount: dec(row.totalTerminationAmount),
    status: row.status as ServiceTerminationDto["status"],
    notes: row.notes,
    adjustmentNotes: row.adjustmentNotes,
    createdByName: row.createdByName,
    finalizedByName: row.finalizedByName,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    commissionLinks: (row.commissionLinks ?? []).map((l) => ({
      id: l.id,
      commissionReportKey: l.commissionReportKey,
      commissionPersonId: l.commissionPersonId,
      commissionPersonName: l.commissionPersonName,
      periodLabel: l.periodLabel,
      orderCode: l.orderCode ?? null,
      commissionAmount: dec(l.commissionAmount),
      source: l.source,
      statusLabel: l.statusLabel,
      commissionsHref: commissionsHrefForReport({
        year,
        months: "all",
        sellerId: "all",
        search: l.commissionPersonName ?? row.personName,
      }),
    })),
  };
}

function buildCalcFromInput(input: ServiceTerminationPreviewInput) {
  const mode = (input.calculationMode ?? "WORKED_MONTHS") as ServiceTerminationCalculationMode;
  const links = input.commissionLinks ?? [];
  const commissionFromLinks = links.reduce((s, l) => s + (Number(l.commissionAmount) || 0), 0);
  const commissionReportTotal =
    input.commissionReportTotal != null && Number.isFinite(Number(input.commissionReportTotal))
      ? Number(input.commissionReportTotal)
      : commissionFromLinks;

  return calculateServiceTermination({
    monthlyServiceAmount: input.monthlyServiceAmount,
    averageWorkedDaysPerMonth: input.averageWorkedDaysPerMonth,
    hoursPerDay: input.hoursPerDay,
    monthlyHours: input.monthlyHours,
    restDaysPerYear: input.restDaysPerYear,
    calculationMode: mode,
    workedMonths: input.workedMonths,
    workedDays: input.workedDays,
    contractStartDate: input.contractStartDate,
    contractEndDate: input.contractEndDate,
    extraWorkedDays: input.extraWorkedDays,
    noticePenaltyAmount: input.noticePenaltyAmount,
    commissionReportTotal,
    otherCredits: input.otherCredits,
    otherDiscounts: input.otherDiscounts,
  });
}

function mapCommissionLinkCreate(l: ServiceTerminationCommissionLinkDto) {
  return {
    commissionReportKey: l.commissionReportKey,
    commissionPersonId: l.commissionPersonId,
    commissionPersonName: l.commissionPersonName,
    periodLabel: l.periodLabel,
    orderCode: l.orderCode?.trim() || null,
    commissionAmount: l.commissionAmount,
    source: l.source,
    statusLabel: l.statusLabel,
  };
}

export function previewSupplierServiceTermination(
  input: ServiceTerminationPreviewInput
): {
  calc: ReturnType<typeof calculateServiceTermination>;
  proportionalRestDaysLabel: string;
} {
  if (!input.personName?.trim()) {
    throw new SupplierServiceTerminationError("Informe o nome do prestador.", "PERSON_REQUIRED");
  }
  parseYmd(input.contractStartDate);
  parseYmd(input.contractEndDate);
  const calc = buildCalcFromInput(input);
  return {
    calc,
    proportionalRestDaysLabel: formatProportionalRestDaysLabel(calc.proportionalRestDays),
  };
}

export async function listSupplierServiceTerminations(
  supplierId: string
): Promise<ServiceTerminationDto[]> {
  const rows = await prisma.supplierServiceTermination.findMany({
    where: { supplierId },
    include: {
      supplier: { select: { displayName: true } },
      commissionLinks: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(mapRowToDto);
}

export async function getSupplierServiceTermination(
  supplierId: string,
  id: string
): Promise<ServiceTerminationDto> {
  const row = await prisma.supplierServiceTermination.findFirst({
    where: { id, supplierId },
    include: {
      supplier: { select: { displayName: true } },
      commissionLinks: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) {
    throw new SupplierServiceTerminationError("Encerramento não encontrado.", "NOT_FOUND", 404);
  }
  return mapRowToDto(row);
}

async function assertSupplierExists(supplierId: string): Promise<{ displayName: string }> {
  const s = await prisma.financialSupplier.findUnique({
    where: { id: supplierId },
    select: { id: true, displayName: true },
  });
  if (!s) {
    throw new SupplierServiceTerminationError("Fornecedor não encontrado.", "SUPPLIER_NOT_FOUND", 404);
  }
  return s;
}

export async function createSupplierServiceTermination(input: {
  supplierId: string;
  body: ServiceTerminationPreviewInput;
  userId?: string | null;
  userName?: string | null;
}): Promise<ServiceTerminationDto> {
  const supplier = await assertSupplierExists(input.supplierId);
  const { calc } = previewSupplierServiceTermination(input.body);
  const links = input.body.commissionLinks ?? [];

  const created = await prisma.supplierServiceTermination.create({
    data: {
      supplierId: input.supplierId,
      personName: input.body.personName.trim(),
      personDocument: input.body.personDocument?.trim() || null,
      serviceRole: input.body.serviceRole?.trim() || null,
      contractStartDate: parseYmd(input.body.contractStartDate),
      contractEndDate: parseYmd(input.body.contractEndDate),
      monthlyServiceAmount: input.body.monthlyServiceAmount,
      averageWorkedDaysPerMonth: calc.averageWorkedDaysPerMonth,
      hoursPerDay: calc.hoursPerDay,
      monthlyHours: calc.monthlyHours,
      hourlyServiceAmount: calc.hourlyServiceAmount,
      dailyServiceAmount: calc.dailyServiceAmount,
      restDaysPerYear: calc.restDaysPerYear,
      calculationMode: calc.calculationMode,
      workedMonths: calc.workedMonths,
      workedDays: calc.workedDays,
      proportionalRestDays: calc.proportionalRestDays,
      proportionalRestAmount: calc.proportionalRestAmount,
      extraWorkedDays: calc.extraWorkedDays,
      extraWorkedAmount: calc.extraWorkedAmount,
      noticePenaltyAmount: calc.noticePenaltyAmount,
      commissionReportId: links[0]?.commissionReportKey ?? null,
      commissionReportTotal: calc.commissionReportTotal,
      otherCredits: calc.otherCredits,
      otherDiscounts: calc.otherDiscounts,
      totalTerminationAmount: calc.totalTerminationAmount,
      status: "DRAFT",
      notes: input.body.notes?.trim() || null,
      adjustmentNotes: input.body.adjustmentNotes?.trim() || null,
      createdById: input.userId ?? null,
      createdByName: input.userName ?? null,
      commissionLinks: {
        create: links.map(mapCommissionLinkCreate),
      },
    },
    include: {
      supplier: { select: { displayName: true } },
      commissionLinks: true,
    },
  });

  const dto = await getSupplierServiceTermination(input.supplierId, created.id);
  await writeTerminationAudit({
    entityId: created.id,
    action: SERVICE_TERMINATION_AUDIT_ACTIONS.CREATE,
    afterJson: { ...dto, supplierName: supplier.displayName },
    userId: input.userId,
    userName: input.userName,
  });
  return dto;
}

export async function updateSupplierServiceTermination(input: {
  supplierId: string;
  id: string;
  body: ServiceTerminationPreviewInput;
  userId?: string | null;
  userName?: string | null;
}): Promise<ServiceTerminationDto> {
  const before = await getSupplierServiceTermination(input.supplierId, input.id);
  if (before.status === "FINALIZED") {
    throw new SupplierServiceTerminationError(
      "Encerramento finalizado não pode ser alterado.",
      "FINALIZED_LOCKED",
      409
    );
  }
  if (before.status === "CANCELED") {
    throw new SupplierServiceTerminationError(
      "Encerramento cancelado não pode ser alterado.",
      "CANCELED",
      409
    );
  }

  const { calc } = previewSupplierServiceTermination(input.body);
  const links = input.body.commissionLinks ?? [];

  await prisma.$transaction(async (tx) => {
    await tx.supplierServiceTerminationCommissionLink.deleteMany({
      where: { terminationId: input.id },
    });
    await tx.supplierServiceTermination.update({
      where: { id: input.id },
      data: {
        personName: input.body.personName.trim(),
        personDocument: input.body.personDocument?.trim() || null,
        serviceRole: input.body.serviceRole?.trim() || null,
        contractStartDate: parseYmd(input.body.contractStartDate),
        contractEndDate: parseYmd(input.body.contractEndDate),
        monthlyServiceAmount: input.body.monthlyServiceAmount,
        averageWorkedDaysPerMonth: calc.averageWorkedDaysPerMonth,
        hoursPerDay: calc.hoursPerDay,
        monthlyHours: calc.monthlyHours,
        hourlyServiceAmount: calc.hourlyServiceAmount,
        dailyServiceAmount: calc.dailyServiceAmount,
        restDaysPerYear: calc.restDaysPerYear,
        calculationMode: calc.calculationMode,
        workedMonths: calc.workedMonths,
        workedDays: calc.workedDays,
        proportionalRestDays: calc.proportionalRestDays,
        proportionalRestAmount: calc.proportionalRestAmount,
        extraWorkedDays: calc.extraWorkedDays,
        extraWorkedAmount: calc.extraWorkedAmount,
        noticePenaltyAmount: calc.noticePenaltyAmount,
        commissionReportId: links[0]?.commissionReportKey ?? null,
        commissionReportTotal: calc.commissionReportTotal,
        otherCredits: calc.otherCredits,
        otherDiscounts: calc.otherDiscounts,
        totalTerminationAmount: calc.totalTerminationAmount,
        notes: input.body.notes?.trim() || null,
        adjustmentNotes: input.body.adjustmentNotes?.trim() || null,
        commissionLinks: {
          create: links.map(mapCommissionLinkCreate),
        },
      },
    });
  });

  const after = await getSupplierServiceTermination(input.supplierId, input.id);
  await writeTerminationAudit({
    entityId: input.id,
    action: SERVICE_TERMINATION_AUDIT_ACTIONS.UPDATE,
    beforeJson: before,
    afterJson: after,
    userId: input.userId,
    userName: input.userName,
  });
  return after;
}

export async function finalizeSupplierServiceTermination(input: {
  supplierId: string;
  id: string;
  userId?: string | null;
  userName?: string | null;
}): Promise<ServiceTerminationDto> {
  const before = await getSupplierServiceTermination(input.supplierId, input.id);
  if (before.status === "FINALIZED") return before;
  if (before.status === "CANCELED") {
    throw new SupplierServiceTerminationError(
      "Não é possível finalizar um encerramento cancelado.",
      "CANCELED",
      409
    );
  }
  await prisma.supplierServiceTermination.update({
    where: { id: input.id },
    data: {
      status: "FINALIZED",
      finalizedAt: new Date(),
      finalizedById: input.userId ?? null,
      finalizedByName: input.userName ?? null,
    },
  });
  const after = await getSupplierServiceTermination(input.supplierId, input.id);
  await writeTerminationAudit({
    entityId: input.id,
    action: SERVICE_TERMINATION_AUDIT_ACTIONS.FINALIZE,
    beforeJson: before,
    afterJson: after,
    userId: input.userId,
    userName: input.userName,
  });
  return after;
}

export async function cancelSupplierServiceTermination(input: {
  supplierId: string;
  id: string;
  userId?: string | null;
  userName?: string | null;
}): Promise<ServiceTerminationDto> {
  const before = await getSupplierServiceTermination(input.supplierId, input.id);
  if (before.status === "FINALIZED") {
    throw new SupplierServiceTerminationError(
      "Encerramento finalizado não pode ser cancelado por esta API.",
      "FINALIZED_LOCKED",
      409
    );
  }
  await prisma.supplierServiceTermination.update({
    where: { id: input.id },
    data: { status: "CANCELED" },
  });
  const after = await getSupplierServiceTermination(input.supplierId, input.id);
  await writeTerminationAudit({
    entityId: input.id,
    action: SERVICE_TERMINATION_AUDIT_ACTIONS.CANCEL,
    beforeJson: before,
    afterJson: after,
    userId: input.userId,
    userName: input.userName,
  });
  return after;
}

/**
 * Consulta o relatório oficial de Comissões (mesma fonte da tela Relatórios).
 * Read-only: não recalcula, não altera fechamento / pagamento.
 */
export async function searchCommissionReportsForSupplierTermination(input: {
  year: number;
  months?: CommissionReportsMonthsFilter | string | null;
  sellerId?: string | null;
  search?: string | null;
  /** Alias legado — aplicado como busca livre se `search` estiver vazio. */
  searchName?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<ServiceTerminationCommissionSearchResult> {
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new SupplierServiceTerminationError(
      "Informe um ano válido (2000–2100).",
      "INVALID_YEAR"
    );
  }
  const months: CommissionReportsMonthsFilter =
    typeof input.months === "string" || input.months == null
      ? parseMonthsFilter(input.months ?? "all")
      : input.months === "all"
        ? "all"
        : input.months;
  const sellerId =
    input.sellerId && input.sellerId.trim() && input.sellerId !== "all"
      ? input.sellerId.trim()
      : "all";
  const search =
    (input.search?.trim() || input.searchName?.trim() || null) as string | null;
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(input.pageSize) || 100));

  const query: CommissionReportsQuery = {
    year,
    months,
    sellerId,
    status: "all",
    search,
    page,
    pageSize,
  };

  const payload = await getCommissionReportsPage(query, TERMINATION_COMMISSION_READ_SCOPE);
  const hrefBase = commissionsHrefForReport({
    year,
    months,
    sellerId,
    search,
  });

  return {
    sellerOptions: payload.sellerOptions ?? [],
    summary: {
      totalCommission: payload.summary.totalCommission,
      commissionableBase: payload.summary.commissionableBase,
      receivedAmount: payload.summary.receivedAmount,
      recordCount: payload.summary.recordCount,
    },
    records: (payload.records ?? []).map((row) => ({
      lineKey: row.lineKey,
      year: row.year,
      month: row.month,
      settlementDate: row.settlementDate,
      sellerId: row.sellerId,
      sellerName: row.sellerName,
      customerName: row.customerName,
      orderCode: row.orderCode,
      nfeNumber: row.nfeNumber,
      receivableNumber:
        row.receivableNumber ??
        (row.nomusReceivableId != null ? String(row.nomusReceivableId) : null),
      receivedAmount: row.receivedAmount,
      commissionableBaseAmount: row.commissionableBaseAmount,
      ratePercent: row.ratePercent,
      finalCommissionAmount: row.finalCommissionAmount,
      lineStatus: row.lineStatus,
      statusReason: row.statusReason,
      periodStatus: row.periodStatus,
      source: row.source,
      commissionsHref: hrefBase,
    })),
    pagination: payload.pagination,
    filtersApplied: {
      year: payload.filtersApplied.year,
      months: payload.filtersApplied.months,
      sellerId: payload.filtersApplied.sellerId,
      search: payload.filtersApplied.search,
    },
  };
}

/** Linhas formatadas do PDF executivo (mesmo conteúdo do relatório de impressão). */
export function buildServiceTerminationPdfDocumentLines(
  dto: ServiceTerminationDto
): PdfLine[] {
  const model = buildServiceTerminationPrintModel(dto);
  const lines: PdfLine[] = [
    { type: "title", text: "Encerramento de Prestacao de Servico" },
    { type: "subtitle", text: "Verbas de encerramento — calculo gerencial/contratual" },
    {
      type: "banner",
      text: `Fornecedor: ${model.supplierName}  |  Prestador: ${model.personName}  |  Status: ${model.statusLabel}`,
    },
    { type: "spacer" },
    { type: "subtitle", text: "1. Identificacao" },
    { type: "kv", label: "Fornecedor", value: model.supplierName },
    { type: "kv", label: "Prestador", value: model.personName },
    { type: "kv", label: "Documento", value: model.personDocument },
    { type: "kv", label: "Funcao/servico", value: model.serviceRole },
    { type: "kv", label: "Periodo do contrato", value: model.periodLabel },
    { type: "spacer" },
    { type: "subtitle", text: "2. Base de calculo" },
    {
      type: "table",
      headers: ["Campo", "Valor"],
      colWidths: [420, 350],
      rows: [
        ["Valor mensal", formatPdfMoneyBr(model.monthlyServiceAmount)],
        ["Dias medios trabalhados/mes", formatPdfNumberBr(model.averageWorkedDaysPerMonth, 2)],
        ["Horas por dia", formatPdfNumberBr(model.hoursPerDay, 2)],
        ["Horas por mes", formatPdfNumberBr(model.monthlyHours, 2)],
        ["Valor hora", formatPdfMoneyBr(model.hourlyServiceAmount)],
        ["Valor dia", formatPdfMoneyBr(model.dailyServiceAmount)],
        ["Descanso anual contratado", `${formatPdfNumberBr(model.restDaysPerYear, 0)} dias`],
        ["Modo de calculo", model.calcModeLabel],
      ],
    },
    { type: "spacer" },
    { type: "subtitle", text: "3. Calculo proporcional e dias a mais" },
    {
      type: "table",
      headers: ["Campo", "Valor"],
      colWidths: [420, 350],
      rows: [
        ["Meses trabalhados", formatPdfNumberBr(model.workedMonths, 2)],
        ["Dias trabalhados", formatPdfNumberBr(model.workedDays, 0)],
        ["Dias proporcionais de descanso", `${model.proportionalRestDaysLabel} dias`],
        ["Valor descanso proporcional", formatPdfMoneyBr(model.proportionalRestAmount)],
        ["Dias a mais", formatPdfNumberBr(model.extraWorkedDays, 0)],
        ["Valor dias a mais", formatPdfMoneyBr(model.extraWorkedAmount)],
      ],
    },
    { type: "spacer" },
    { type: "subtitle", text: "4. Comissoes (oficial / lancamento manual)" },
  ];

  if (model.commissionRows.length === 0) {
    lines.push({ type: "text", text: "Nenhuma comissao vinculada ou lancada." });
  } else {
    lines.push({
      type: "table",
      headers: ["Pedido", "Referencia", "Pessoa", "Fonte", "Comissao"],
      colWidths: [110, 220, 180, 120, 140],
      rows: model.commissionRows.map((r) => [
        r.orderCode,
        r.description,
        r.personName,
        r.source,
        formatPdfMoneyBr(r.amount),
      ]),
    });
  }
  lines.push({
    type: "kv",
    label: "Total comissoes",
    value: formatPdfMoneyBr(model.commissionReportTotal),
  });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "5. Multa e ajustes" });
  lines.push({
    type: "table",
    headers: ["Campo", "Valor"],
    colWidths: [420, 350],
    rows: [
      ["Multa sem aviso de 30 dias", formatPdfMoneyBr(model.noticePenaltyAmount)],
      ["Outros creditos", formatPdfMoneyBr(model.otherCredits)],
      ["Outros descontos", formatPdfMoneyBr(model.otherDiscounts)],
      ["Obs. do ajuste", model.adjustmentNotes ?? "—"],
    ],
  });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "6. Totalizacao" });
  lines.push({
    type: "table",
    headers: ["Verba", "Valor"],
    colWidths: [420, 350],
    rows: model.totalizationRows.map((r) => [r.label, formatPdfMoneyBr(r.value)]),
  });
  lines.push({ type: "spacer" });
  if (model.notes) {
    lines.push({ type: "subtitle", text: "Observacoes" });
    lines.push({ type: "text", text: model.notes });
    lines.push({ type: "spacer" });
  }
  lines.push({ type: "banner", text: SERVICE_TERMINATION_PRINT_FOOTER_NOTE });
  lines.push({
    type: "text",
    text: "Documento gerado pelo IndusCost. Layout executivo alinhado ao padrao do Pedido de Venda.",
  });
  return lines;
}

/** Compat: texto plano para QA / auditoria do conteúdo. */
export function buildServiceTerminationPdfLines(dto: ServiceTerminationDto): string[] {
  return buildServiceTerminationPdfDocumentLines(dto).flatMap((line) => {
    if (line.type === "title" || line.type === "subtitle" || line.type === "banner") {
      return [line.text];
    }
    if (line.type === "text") return [line.text];
    if (line.type === "kv") return [`${line.label}: ${line.value}`];
    if (line.type === "table") {
      return [
        line.headers.join(" | "),
        ...line.rows.map((r) => r.join(" | ")),
      ];
    }
    return [];
  });
}

export async function exportSupplierServiceTerminationPdf(input: {
  supplierId: string;
  id: string;
  userId?: string | null;
  userName?: string | null;
}): Promise<{ buffer: Buffer; filename: string }> {
  const dto = await getSupplierServiceTermination(input.supplierId, input.id);
  const buffer = buildFormattedLandscapePdf({
    title: "Encerramento de Prestacao de Servico",
    lines: buildServiceTerminationPdfDocumentLines(dto),
  });
  await writeTerminationAudit({
    entityId: input.id,
    action: SERVICE_TERMINATION_AUDIT_ACTIONS.EXPORT_PDF,
    afterJson: { total: dto.totalTerminationAmount },
    userId: input.userId,
    userName: input.userName,
  });
  return {
    buffer,
    filename: `encerramento-prestacao-${dto.personName.replace(/\s+/g, "-").slice(0, 40)}.pdf`,
  };
}

export async function exportSupplierServiceTerminationXlsx(input: {
  supplierId: string;
  id: string;
  userId?: string | null;
  userName?: string | null;
}): Promise<{ buffer: Buffer; filename: string }> {
  const dto = await getSupplierServiceTermination(input.supplierId, input.id);
  const rows = [
    ["Campo", "Valor"],
    ["Fornecedor", dto.supplierName],
    ["Prestador", dto.personName],
    ["Período início", dto.contractStartDate],
    ["Período fim", dto.contractEndDate],
    ["Valor mensal", dto.monthlyServiceAmount],
    ["Dias médios trabalhados/mês", dto.averageWorkedDaysPerMonth],
    ["Horas por dia", dto.hoursPerDay],
    ["Horas/mês", dto.monthlyHours],
    ["Valor hora", dto.hourlyServiceAmount],
    ["Valor dia", dto.dailyServiceAmount],
    ["Descanso anual (dias)", dto.restDaysPerYear],
    ["Modo", dto.calculationMode],
    ["Meses trabalhados", dto.workedMonths],
    ["Dias trabalhados", dto.workedDays],
    ["Dias proporcionais", dto.proportionalRestDays],
    ["Valor descanso proporcional", dto.proportionalRestAmount],
    ["Dias a mais trabalhados", dto.extraWorkedDays],
    ["Valor dias a mais", dto.extraWorkedAmount],
    ["Multa sem aviso 30 dias", dto.noticePenaltyAmount],
    ["Total comissão vinculada", dto.commissionReportTotal],
    ["Outros créditos", dto.otherCredits],
    ["Outros descontos", dto.otherDiscounts],
    ["Total final a pagar", dto.totalTerminationAmount],
    ["Status", dto.status],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Encerramento");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await writeTerminationAudit({
    entityId: input.id,
    action: SERVICE_TERMINATION_AUDIT_ACTIONS.EXPORT_XLSX,
    afterJson: { total: dto.totalTerminationAmount },
    userId: input.userId,
    userName: input.userName,
  });
  return {
    buffer,
    filename: `encerramento-prestacao-${dto.personName.replace(/\s+/g, "-").slice(0, 40)}.xlsx`,
  };
}

export type { ServiceTerminationCommissionLinkDto };
