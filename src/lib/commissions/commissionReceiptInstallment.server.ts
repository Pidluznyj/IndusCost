/**
 * Total de parcelas das linhas do fechamento por recebimento (PREVIEW e CLOSED).
 *
 * Duas consultas em lote — nunca uma por linha:
 *   1. CRs das linhas (`externalId`) → NF atual de cada um (`sourceInvoiceId`);
 *   2. TODOS os CRs dessas NFs, na mesma ordem do scheduler
 *      (`loadReceivablesForNfe`: `dueDate ASC, externalId ASC`), recebidos ou não.
 * Só leitura: não altera schedule, ledger, fechamento nem valores. Falha na leitura
 * não derruba a tela — as linhas seguem sem total ("2/—").
 */
import type { PrismaClient } from "@prisma/client";
import type { ReceiptClosingPagePayload } from "./commissionReceiptClosingApi.shared.js";
import {
  applyReceiptClosingInstallmentTotals,
  buildReceivableInstallmentPositions,
  type ReceivableInstallmentPosition,
} from "./commissionReceiptInstallment.shared.js";

type InstallmentDb = Pick<PrismaClient, "nomusAccountsReceivable">;

function uniquePositiveIds(values: Iterable<number | null | undefined>): number[] {
  const out = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) out.add(value);
  }
  return [...out];
}

export async function loadReceivableInstallmentPositions(
  db: InstallmentDb,
  receivableIds: Iterable<number | null | undefined>
): Promise<Map<number, ReceivableInstallmentPosition>> {
  const ids = uniquePositiveIds(receivableIds);
  if (ids.length === 0) return new Map();

  const ownRows = await db.nomusAccountsReceivable.findMany({
    where: { externalId: { in: ids } },
    select: { externalId: true, sourceInvoiceId: true },
  });
  const invoiceIds = uniquePositiveIds(ownRows.map((row) => row.sourceInvoiceId));
  if (invoiceIds.length === 0) return new Map();

  const invoiceRows = await db.nomusAccountsReceivable.findMany({
    where: { sourceInvoiceId: { in: invoiceIds } },
    select: { externalId: true, sourceInvoiceId: true, dueDate: true },
    orderBy: [{ sourceInvoiceId: "asc" }, { dueDate: "asc" }, { externalId: "asc" }],
  });
  return buildReceivableInstallmentPositions(invoiceRows);
}

export async function enrichReceiptClosingPageInstallments(
  db: InstallmentDb,
  page: ReceiptClosingPagePayload
): Promise<ReceiptClosingPagePayload> {
  if (page.lines.length === 0 && page.groupCompanyAuditLines.length === 0) return page;
  try {
    const positions = await loadReceivableInstallmentPositions(
      db,
      [...page.lines, ...page.groupCompanyAuditLines].map((line) => line.nomusReceivableId)
    );
    return {
      ...page,
      lines: applyReceiptClosingInstallmentTotals(page.lines, positions),
      groupCompanyAuditLines: applyReceiptClosingInstallmentTotals(
        page.groupCompanyAuditLines,
        positions
      ),
    };
  } catch (error) {
    console.warn(
      "[commission-receipt-closing] total de parcelas indisponível; linhas seguem sem denominador.",
      error
    );
    return page;
  }
}
