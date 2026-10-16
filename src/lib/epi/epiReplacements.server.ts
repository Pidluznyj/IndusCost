/**
 * Controle de vencimentos de EPIs/uniformes (Dashboard de Pessoas) e exportação de entregas.
 * Derivado das entregas oficiais (sem job em background): uma consulta, sem N+1.
 */
import type { PrismaClient } from "@prisma/client";
import { addDaysIso } from "../employeeLifecycle.js";
import {
  EPI_DELIVERY_STATUS_LABELS,
  EPI_DUE_WINDOW_DAYS,
  EPI_ITEM_TYPE_LABELS,
  EPI_UNIT_LABELS,
  countByBand,
  daysUntil,
  epiDueBand,
  isEpiDeliveryStatus,
  isEpiItemType,
  isEpiUnit,
  sortReplacementRows,
  type EpiDueBand,
  type EpiReplacementRow,
} from "./epiRules.js";
import { EPI_DOCUMENT_STATUS_LABELS } from "./epiForm.js";
import { epiEventDocumentState } from "./epiForms.server.js";

export type EpiReplacementsSummary = {
  todayIso: string;
  windowDays: number;
  /** Pendências = entregas vigentes com troca prevista (não colaboradores distintos). */
  counts: Record<EpiDueBand, number>;
  employeesWithPending: number;
  rows: EpiReplacementRow[];
  departments: Array<{ id: string; label: string }>;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Vigentes (status ACTIVE) com data prevista até hoje + 60 dias, de colaboradores não desligados.
 * Item inativado no catálogo continua aparecendo: a obrigação de troca da entrega permanece.
 */
export async function loadEpiReplacements(prisma: PrismaClient, todayIso: string): Promise<EpiReplacementsSummary> {
  const limit = addDaysIso(todayIso, EPI_DUE_WINDOW_DAYS);
  const rows = await prisma.hrEpiDelivery.findMany({
    where: {
      status: "ACTIVE",
      replacementDueDate: { not: null, lte: new Date(`${limit}T00:00:00.000Z`) },
      employee: { OR: [{ status: null }, { status: { not: "INACTIVE" } }] },
    },
    orderBy: { replacementDueDate: "asc" },
    take: 5000,
    select: {
      id: true,
      employeeId: true,
      item: true,
      itemCode: true,
      itemType: true,
      quantity: true,
      deliveredAt: true,
      replacementDueDate: true,
      employee: {
        select: {
          name: true,
          socialName: true,
          department: true,
          departmentId: true,
          orgDepartment: { select: { id: true, name: true } },
        },
      },
    },
  });
  const out: EpiReplacementRow[] = [];
  for (const r of rows) {
    const due = iso(r.replacementDueDate)!;
    const band = epiDueBand(due, todayIso);
    if (!band) continue;
    out.push({
      deliveryId: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee.socialName?.trim() || r.employee.name,
      departmentName: r.employee.orgDepartment?.name ?? (r.employee.department?.trim() || null),
      // Sem departamento estruturado, o setor em texto do cadastro serve de chave do filtro.
      departmentId:
        r.employee.orgDepartment?.id ??
        r.employee.departmentId ??
        (r.employee.department?.trim() ? `setor:${r.employee.department.trim()}` : null),
      itemCode: r.itemCode,
      itemDescription: r.item,
      itemType: r.itemType,
      quantity: r.quantity,
      deliveredOn: iso(r.deliveredAt)!,
      replacementDueDate: due,
      daysLeft: daysUntil(due, todayIso),
      band,
    });
  }
  const sorted = sortReplacementRows(out);
  const departments = new Map<string, string>();
  for (const r of sorted) {
    if (r.departmentId && r.departmentName) departments.set(r.departmentId, r.departmentName);
  }
  return {
    todayIso,
    windowDays: EPI_DUE_WINDOW_DAYS,
    counts: countByBand(sorted),
    employeesWithPending: new Set(sorted.map((r) => r.employeeId)).size,
    rows: sorted,
    departments: [...departments.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const br = (isoDay: string | null) => (isoDay ? isoDay.split("-").reverse().join("/") : "");

/** Relatório de entregas (todas as situações, com o retrato do item) em CSV ";" para Excel pt-BR. */
export async function exportEpiDeliveriesCsv(
  prisma: PrismaClient,
  opts: { from?: string | null; to?: string | null; todayIso: string },
): Promise<string> {
  const rows = await prisma.hrEpiDelivery.findMany({
    where: {
      ...(opts.from || opts.to
        ? {
            deliveredAt: {
              ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00.000Z`) } : {}),
              ...(opts.to ? { lte: new Date(`${opts.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }],
    take: 50000,
    select: {
      deliveredAt: true,
      item: true,
      itemCode: true,
      itemType: true,
      itemCaNumber: true,
      itemUnit: true,
      quantity: true,
      size: true,
      responsibleName: true,
      replacementDays: true,
      replacementDueDate: true,
      replacementAdjustReason: true,
      status: true,
      statusReason: true,
      notes: true,
      eventId: true,
      event: {
        select: {
          forms: { where: { status: "ACTIVE" }, select: { id: true, documentNumber: true, status: true } },
          receipts: { where: { status: "CURRENT" }, select: { formId: true, status: true, validationResult: true } },
        },
      },
      employee: { select: { name: true, socialName: true, department: true, orgDepartment: { select: { name: true } } } },
    },
  });
  const header = [
    "Colaborador",
    "Setor",
    "Data da entrega",
    "Código",
    "EPI / Uniforme",
    "Tipo",
    "CA",
    "Unidade",
    "Quantidade",
    "Tamanho",
    "Responsável",
    "Prazo de troca (dias)",
    "Próxima troca",
    "Dias restantes",
    "Situação",
    "Motivo da situação",
    "Justificativa do prazo",
    "Ficha da entrega (nº vigente)",
    "Situação documental",
    "Observações",
  ];
  const lines = [header.join(";")];
  for (const r of rows) {
    const due = iso(r.replacementDueDate);
    lines.push(
      [
        r.employee.socialName?.trim() || r.employee.name,
        r.employee.orgDepartment?.name ?? r.employee.department ?? "",
        br(iso(r.deliveredAt)),
        r.itemCode ?? "",
        r.item,
        isEpiItemType(r.itemType) ? EPI_ITEM_TYPE_LABELS[r.itemType] : "",
        r.itemCaNumber ?? "",
        isEpiUnit(r.itemUnit) ? EPI_UNIT_LABELS[r.itemUnit] : "",
        r.quantity,
        r.size ?? "",
        r.responsibleName ?? "",
        r.replacementDays ?? "",
        due ? br(due) : "Sem troca programada",
        r.status === "ACTIVE" && due ? daysUntil(due, opts.todayIso) : "",
        isEpiDeliveryStatus(r.status) ? EPI_DELIVERY_STATUS_LABELS[r.status] : r.status,
        r.statusReason ?? "",
        r.replacementAdjustReason ?? "",
        r.event.forms[0]?.documentNumber ?? "",
        EPI_DOCUMENT_STATUS_LABELS[epiEventDocumentState(r.event.forms, r.event.receipts).status],
        r.notes ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
