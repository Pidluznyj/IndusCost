/**
 * Parcela do título (CR) no fechamento por recebimento — "número/total" (ex.: 2/3).
 * Parte pura, segura para frontend e para o export XLSX.
 *
 * Número: o que a linha JÁ traz em `installmentNumber` — gravado pelo scheduler
 * (`loadReceivablesForNfe` em commissionReceivableScheduler.server.ts: todos os
 * `NomusAccountsReceivable` da NF por `sourceInvoiceId`, ordem `dueDate ASC,
 * externalId ASC`, número = posição + 1) ou persistido no ledger do fechamento.
 * Nunca é recalculado aqui (ele também compõe a chave da linha do ledger).
 *
 * Total: quantidade de TODOS os CRs da mesma NF (`sourceInvoiceId`), recebidos ou
 * não no mês — a mesma população que o scheduler numera. Nunca a quantidade de
 * linhas do fechamento (NF com 3 parcelas e 2 recebidas no mês = 1/3 e 2/3).
 *
 * Segurança do denominador: o total só é aceito quando a posição ATUAL do CR nessa
 * população (mesma ordem do scheduler) é igual ao número gravado. Se a população
 * mudou desde a numeração (ex.: CR incluído antes dele), o total fica desconhecido
 * e a tela mostra "2/—" — nunca um denominador inventado.
 */

export type ReceivableInstallmentSourceRow = {
  externalId: number;
  sourceInvoiceId: number | null;
  dueDate: Date | string | null;
};

export type ReceivableInstallmentPosition = {
  sourceInvoiceId: number;
  /** Posição 1-based na ordem do scheduler. */
  position: number;
  /** Quantidade de CRs da NF. */
  total: number;
};

/** Texto quando a parcela não é conhecida. */
export const INSTALLMENT_LABEL_UNKNOWN = "—";

function dueDateTime(value: Date | string | null): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Ordem do scheduler (`orderBy: [{ dueDate: "asc" }, { externalId: "asc" }]`):
 * vencimento crescente — sem vencimento por último, como o PostgreSQL faz no ASC —
 * e, no empate, `externalId` crescente.
 */
export function compareReceivablesInInstallmentOrder(
  a: ReceivableInstallmentSourceRow,
  b: ReceivableInstallmentSourceRow
): number {
  const ta = dueDateTime(a.dueDate);
  const tb = dueDateTime(b.dueDate);
  if (ta !== tb) {
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  }
  return a.externalId - b.externalId;
}

/**
 * Posição e total de cada CR dentro da sua NF, a partir de TODOS os CRs das NFs
 * envolvidas (uma consulta em lote). CR sem NF não recebe posição.
 */
export function buildReceivableInstallmentPositions(
  rows: readonly ReceivableInstallmentSourceRow[]
): Map<number, ReceivableInstallmentPosition> {
  const byInvoice = new Map<number, Map<number, ReceivableInstallmentSourceRow>>();
  for (const row of rows) {
    if (row.sourceInvoiceId == null || !Number.isInteger(row.externalId)) continue;
    const group = byInvoice.get(row.sourceInvoiceId) ?? new Map<number, ReceivableInstallmentSourceRow>();
    group.set(row.externalId, row);
    byInvoice.set(row.sourceInvoiceId, group);
  }
  const positions = new Map<number, ReceivableInstallmentPosition>();
  for (const [sourceInvoiceId, group] of byInvoice) {
    const ordered = [...group.values()].sort(compareReceivablesInInstallmentOrder);
    ordered.forEach((row, index) => {
      positions.set(row.externalId, {
        sourceInvoiceId,
        position: index + 1,
        total: ordered.length,
      });
    });
  }
  return positions;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Total de parcelas da linha, ou null quando não dá para afirmar com segurança:
 * linha sem CR ou sem número, CR sem NF, ou posição atual ≠ número gravado.
 */
export function resolveReceiptClosingInstallmentTotal(
  line: { nomusReceivableId: number | null; installmentNumber: number | null },
  positions: ReadonlyMap<number, ReceivableInstallmentPosition>
): number | null {
  if (line.nomusReceivableId == null || !isPositiveInteger(line.installmentNumber)) return null;
  const entry = positions.get(line.nomusReceivableId);
  if (!entry) return null;
  if (entry.position !== line.installmentNumber) return null;
  return entry.total;
}

/** Linhas novas com `installmentTotal` preenchido; o número da parcela não muda. */
export function applyReceiptClosingInstallmentTotals<
  T extends { nomusReceivableId: number | null; installmentNumber: number | null },
>(lines: readonly T[], positions: ReadonlyMap<number, ReceivableInstallmentPosition>): Array<
  T & { installmentTotal: number | null }
> {
  return lines.map((line) => ({
    ...line,
    installmentTotal: resolveReceiptClosingInstallmentTotal(line, positions),
  }));
}

/**
 * "número/total" da parcela:
 *   (1, 1) → "1/1"; (2, 3) → "2/3";
 *   número sem total confirmado → "2/—" (deixa claro que é a parcela 2 e que o
 *   total não foi confirmado; nunca "1/1" inventado nem "2" lido como quantidade);
 *   sem número → "—" (ou `unknownLabel`, ex.: "" no XLSX).
 * Total menor que o número é tratado como desconhecido.
 */
export function formatInstallmentLabel(
  installmentNumber: number | null | undefined,
  installmentTotal: number | null | undefined,
  unknownLabel: string = INSTALLMENT_LABEL_UNKNOWN
): string {
  if (!isPositiveInteger(installmentNumber)) return unknownLabel;
  if (isPositiveInteger(installmentTotal) && installmentTotal >= installmentNumber) {
    return `${installmentNumber}/${installmentTotal}`;
  }
  return `${installmentNumber}/${INSTALLMENT_LABEL_UNKNOWN}`;
}
