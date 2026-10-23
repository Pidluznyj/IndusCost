/**
 * Guarda do pagamento de comissão contra o fechamento oficial (N:N).
 *
 * Os lotes de pagamento pagam `CommissionRecord` (cálculo por item do pedido), que não
 * conhece o direito econômico do fechamento por recebimento: um pedido retido pela guarda
 * R1, uma parcela ainda não recebida ou um título compartilhado por pedidos de vendedores
 * diferentes podiam ser pagos pelo registro sem lastro no ledger CLOSED. Enquanto o
 * pagamento não for estruturado por direito (ver docs/commissions — plano de pagamentos
 * por direito), o pagamento oficial fica limitado ao que o fechamento liberou:
 *
 *   para cada (vendedor, pedido):
 *     comprometido em lotes ativos + solicitado ≤ Σ comissão LIBERADA nas linhas
 *     COMMISSIONABLE de fechamentos CLOSED até a competência final do lote;
 *   toda competência do lote precisa estar fechada (CLOSED);
 *   registro sem pedido não é rastreável ao direito → recusado.
 *
 * Lógica pura (sem I/O).
 */
import { roundMoney } from "./commission-money.shared.js";

export const COMMISSION_PAYMENT_EXCEEDS_OFFICIAL_CLOSING = "COMMISSION_PAYMENT_EXCEEDS_OFFICIAL_CLOSING";

export type PaymentGuardLedgerLine = {
  canonicalSellerId: string | null;
  nomusOrderId: number | null;
  orderCode: string | null;
  status: string;
  releasedCommissionAmount: number;
};

export type PaymentGuardAmount = {
  nomusOrderId: number | null;
  orderCode: string | null;
  amount: number;
};

export type PaymentGuardRequest = PaymentGuardAmount & { commissionRecordId: string };

export type PaymentGuardOrderRow = {
  orderKey: string;
  orderLabel: string;
  releasedByClosing: number;
  committedInOtherBatches: number;
  requested: number;
  available: number;
};

export type PaymentGuardResult = {
  ok: boolean;
  violations: string[];
  orders: PaymentGuardOrderRow[];
};

const TOLERANCE = 0.01;

function normalizeOrderCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  return digits ? String(Number(digits)) : trimmed.toUpperCase();
}

/** Chave do pedido: id Nomus quando existe; senão o código normalizado. */
export function paymentGuardOrderKey(row: { nomusOrderId: number | null; orderCode: string | null }): string | null {
  if (row.nomusOrderId != null) return `n:${row.nomusOrderId}`;
  const code = normalizeOrderCode(row.orderCode);
  return code ? `c:${code}` : null;
}

export function evaluatePaymentAgainstOfficialClosing(input: {
  commissionPersonId: string;
  /** Linhas do ledger de fechamentos CLOSED até a competência final do lote. */
  ledgerLines: readonly PaymentGuardLedgerLine[];
  /** Valores já comprometidos em OUTROS lotes ativos do vendedor (pago ou a pagar). */
  committed: readonly PaymentGuardAmount[];
  requested: readonly PaymentGuardRequest[];
  /** Competências do lote sem fechamento CLOSED (rótulo MM/AAAA). */
  openCompetences: readonly string[];
}): PaymentGuardResult {
  const violations: string[] = [];
  for (const label of input.openCompetences) {
    violations.push(`competência ${label} sem fechamento oficial encerrado (CLOSED)`);
  }

  // Ledger: nomusOrderId e orderCode podem vir só um dos dois; indexa pelos dois.
  const releasedByKey = new Map<string, number>();
  const labelByKey = new Map<string, string>();
  for (const line of input.ledgerLines) {
    if (line.canonicalSellerId !== input.commissionPersonId || line.status !== "COMMISSIONABLE") continue;
    const keys = new Set(
      [paymentGuardOrderKey({ nomusOrderId: line.nomusOrderId, orderCode: null }), paymentGuardOrderKey({ nomusOrderId: null, orderCode: line.orderCode })].filter(
        (key): key is string => key != null
      )
    );
    for (const key of keys) {
      releasedByKey.set(key, roundMoney((releasedByKey.get(key) ?? 0) + line.releasedCommissionAmount));
      if (line.orderCode) labelByKey.set(key, line.orderCode);
    }
  }
  const releasedFor = (row: { nomusOrderId: number | null; orderCode: string | null }) => {
    const byId = row.nomusOrderId != null ? releasedByKey.get(`n:${row.nomusOrderId}`) : undefined;
    if (byId != null) return byId;
    const code = paymentGuardOrderKey({ nomusOrderId: null, orderCode: row.orderCode });
    return code ? (releasedByKey.get(code) ?? 0) : 0;
  };

  const rows = new Map<string, PaymentGuardOrderRow>();
  const rowFor = (amount: PaymentGuardAmount) => {
    const key = paymentGuardOrderKey(amount);
    if (!key) return null;
    const row = rows.get(key) ?? {
      orderKey: key,
      orderLabel: amount.orderCode ?? labelByKey.get(key) ?? key,
      releasedByClosing: releasedFor(amount),
      committedInOtherBatches: 0,
      requested: 0,
      available: 0,
    };
    rows.set(key, row);
    return row;
  };

  for (const request of input.requested) {
    const row = rowFor(request);
    if (!row) {
      violations.push(`registro ${request.commissionRecordId} sem pedido: pagamento não rastreável ao direito do fechamento`);
      continue;
    }
    row.requested = roundMoney(row.requested + request.amount);
  }
  for (const committed of input.committed) {
    const key = paymentGuardOrderKey(committed);
    const row = key ? rows.get(key) : undefined;
    if (row) row.committedInOtherBatches = roundMoney(row.committedInOtherBatches + committed.amount);
  }

  for (const row of rows.values()) {
    row.available = roundMoney(row.releasedByClosing - row.committedInOtherBatches);
    if (row.requested > row.available + TOLERANCE) {
      violations.push(
        `PD ${row.orderLabel}: solicitado R$ ${row.requested.toFixed(2)} acima do liberado no fechamento oficial (R$ ${row.releasedByClosing.toFixed(2)}, já comprometido R$ ${row.committedInOtherBatches.toFixed(2)})`
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    orders: [...rows.values()].sort((a, b) => a.orderKey.localeCompare(b.orderKey)),
  };
}

export function formatPaymentGuardViolations(violations: readonly string[]): string {
  const head = violations.slice(0, 5).join("; ");
  const more = violations.length > 5 ? ` (+${violations.length - 5})` : "";
  return `Pagamento bloqueado pelo fechamento oficial: ${head}${more}.`;
}
