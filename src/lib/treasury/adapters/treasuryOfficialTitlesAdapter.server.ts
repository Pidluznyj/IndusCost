/**
 * Adapter somente leitura dos títulos oficiais Nomus (CR/CP).
 * Projeta OfficialReceivableView / OfficialPayableView — sem cópia/upsert.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  toOfficialPayableView,
  toOfficialReceivableView,
  type OfficialNomusPayableRow,
  type OfficialNomusReceivableRow,
} from "../mappers/treasuryOfficialTitleMappers.js";
import type {
  OfficialTitlesListFilter,
  OfficialTitlesListResult,
  TreasuryOfficialTitlesAdapter,
} from "./treasuryOfficialTitlesAdapter.types.js";

export type OfficialTitlesDb = PrismaClient | Prisma.TransactionClient;

export type {
  OfficialTitlesListFilter,
  OfficialTitlesListResult,
  TreasuryOfficialTitlesAdapter,
} from "./treasuryOfficialTitlesAdapter.types.js";

const AR_SELECT = {
  id: true,
  externalId: true,
  status: true,
  personId: true,
  personName: true,
  personCnpj: true,
  description: true,
  competenceDate: true,
  dueDate: true,
  amountReceivable: true,
  balanceReceivable: true,
  amountReceived: true,
  settlementDate: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  sourcePresenceStatus: true,
  sourceRemovedAt: true,
  syncedAt: true,
  rawPayload: true,
} satisfies Prisma.NomusAccountsReceivableSelect;

const AP_SELECT = {
  id: true,
  externalId: true,
  status: true,
  personId: true,
  personName: true,
  personCnpj: true,
  description: true,
  documentNumber: true,
  competenceDate: true,
  dueDate: true,
  amountPayable: true,
  balancePayable: true,
  amountPaid: true,
  settlementDate: true,
  paymentDate: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  sourcePresenceStatus: true,
  sourceRemovedAt: true,
  syncedAt: true,
  rawPayload: true,
} satisfies Prisma.NomusAccountsPayableSelect;

function pageOf(filter: OfficialTitlesListFilter): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
  return { page, pageSize };
}

export function createTreasuryOfficialTitlesAdapter(
  prisma: PrismaClient
): TreasuryOfficialTitlesAdapter {
  const client = () => prisma;

  return {
    async findReceivableById(id) {
      const row = await client().nomusAccountsReceivable.findUnique({
        where: { id },
        select: AR_SELECT,
      });
      return row
        ? toOfficialReceivableView(row as OfficialNomusReceivableRow)
        : null;
    },

    async findReceivableByExternalId(externalId) {
      const row = await client().nomusAccountsReceivable.findUnique({
        where: { externalId },
        select: AR_SELECT,
      });
      return row
        ? toOfficialReceivableView(row as OfficialNomusReceivableRow)
        : null;
    },

    async listReceivables(filter = {}) {
      const { page, pageSize } = pageOf(filter);
      const where: Prisma.NomusAccountsReceivableWhereInput = {};
      if (filter.openOnly) {
        where.balanceReceivable = { gt: 0 };
      }
      if (filter.personId != null) where.personId = filter.personId;
      if (filter.externalIds?.length) {
        where.externalId = { in: filter.externalIds };
      }
      if (filter.dueFrom || filter.dueTo) {
        where.dueDate = {};
        if (filter.dueFrom) where.dueDate.gte = filter.dueFrom;
        if (filter.dueTo) where.dueDate.lte = filter.dueTo;
      }
      const [total, rows] = await Promise.all([
        client().nomusAccountsReceivable.count({ where }),
        client().nomusAccountsReceivable.findMany({
          where,
          select: AR_SELECT,
          orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        rows: rows.map((r) =>
          toOfficialReceivableView(r as OfficialNomusReceivableRow)
        ),
        total,
        page,
        pageSize,
      };
    },

    async findPayableById(id) {
      const row = await client().nomusAccountsPayable.findUnique({
        where: { id },
        select: AP_SELECT,
      });
      return row ? toOfficialPayableView(row as OfficialNomusPayableRow) : null;
    },

    async findPayableByExternalId(externalId) {
      const row = await client().nomusAccountsPayable.findUnique({
        where: { externalId },
        select: AP_SELECT,
      });
      return row ? toOfficialPayableView(row as OfficialNomusPayableRow) : null;
    },

    async listPayables(filter = {}) {
      const { page, pageSize } = pageOf(filter);
      const where: Prisma.NomusAccountsPayableWhereInput = {};
      if (filter.openOnly) {
        where.balancePayable = { gt: 0 };
      }
      if (filter.personId != null) where.personId = filter.personId;
      if (filter.externalIds?.length) {
        where.externalId = { in: filter.externalIds };
      }
      if (filter.dueFrom || filter.dueTo) {
        where.dueDate = {};
        if (filter.dueFrom) where.dueDate.gte = filter.dueFrom;
        if (filter.dueTo) where.dueDate.lte = filter.dueTo;
      }
      const [total, rows] = await Promise.all([
        client().nomusAccountsPayable.count({ where }),
        client().nomusAccountsPayable.findMany({
          where,
          select: AP_SELECT,
          orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        rows: rows.map((r) =>
          toOfficialPayableView(r as OfficialNomusPayableRow)
        ),
        total,
        page,
        pageSize,
      };
    },
  };
}
