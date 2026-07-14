/**
 * Status de faturamento do pedido (visão comercial "Faturamento").
 *
 * A coluna "Situação" da listagem de Pedidos de Venda foi substituída por
 * "Faturamento". Este módulo é a **fonte única** dos rótulos e da regra que
 * decide se um pedido é `INVOICED`, `NOT_INVOICED`, `PARTIALLY_INVOICED` ou
 * `CANCELED`.
 *
 * Regra oficial (2026-07):
 *   1. `CANCELED`  ← pedido inteiro cancelado no Nomus (`status === "CANCELLED"`).
 *   2. `INVOICED`  ← NF vinculada cobrindo o valor líquido do pedido.
 *   3. `PARTIALLY_INVOICED` ← há NF vinculada, mas cobertura < 100%.
 *   4. `NOT_INVOICED` ← nenhuma NF vinculada.
 *
 * O que **NÃO** conta como faturado:
 *   - Contas a Receber planejado sem NF (pode existir CR previsto antes da NF).
 *   - Propostas.
 *   - `status = "SENT_TO_NOMUS"` (é status operacional, não é sinal de NF).
 *
 * O motor oficial que consolida a NF vinculada é
 * `loadSalesOrderLinkedNfeContextMap` (`src/lib/salesOrderLinkedNfe.ts`) —
 * usado por Auditoria 360º, Pedido → Caixa e pela listagem operacional.
 *
 * IMPORTANTE: este arquivo é frontend-safe (não importa Prisma).
 */

export type SalesOrderBillingStatus =
  | "INVOICED"
  | "NOT_INVOICED"
  | "PARTIALLY_INVOICED"
  | "CANCELED";

/**
 * Ordem canônica para filtros/legendas: "Faturado" primeiro (positivo),
 * depois "Parcialmente faturado", "Não faturado" e por fim "Cancelado".
 */
export const SALES_ORDER_BILLING_STATUS_ORDER: readonly SalesOrderBillingStatus[] = [
  "INVOICED",
  "PARTIALLY_INVOICED",
  "NOT_INVOICED",
  "CANCELED",
] as const;

const LABELS: Record<SalesOrderBillingStatus, string> = {
  INVOICED: "Faturado",
  PARTIALLY_INVOICED: "Parcialmente faturado",
  NOT_INVOICED: "Não faturado",
  CANCELED: "Cancelado",
};

/** Rótulo em português para exibição em tabela, filtros, PDF, XLSX. */
export function salesOrderBillingStatusLabel(
  status: SalesOrderBillingStatus | null | undefined
): string {
  if (!status) return "—";
  return LABELS[status] ?? "—";
}

/**
 * Classe CSS canônica do badge da coluna Faturamento na listagem.
 * As classes ficam em `sales-order-list-table.css` (variantes `--invoiced`,
 * `--partial`, `--not-invoiced`, `--canceled`).
 */
export function salesOrderBillingStatusBadgeClass(
  status: SalesOrderBillingStatus | null | undefined
): string {
  const base = "so-billing-badge";
  switch (status) {
    case "INVOICED":
      return `${base} ${base}--invoiced`;
    case "PARTIALLY_INVOICED":
      return `${base} ${base}--partial`;
    case "CANCELED":
      return `${base} ${base}--canceled`;
    case "NOT_INVOICED":
    default:
      return `${base} ${base}--not-invoiced`;
  }
}

/** Tooltip institucional exibido ao pairar sobre o badge / cabeçalho da coluna. */
export const SALES_ORDER_BILLING_STATUS_TOOLTIP =
  "Status calculado com base nas NF-e vinculadas ao pedido. " +
  "Contas a Receber planejado sem NF não torna o pedido faturado.";

export type SalesOrderBillingStatusInput = {
  /** Status bruto do pedido (`SalesOrder.status`). */
  status: string | null | undefined;
  /**
   * `true` se o motor oficial (`loadSalesOrderLinkedNfeContextMap`) encontrou
   * pelo menos uma NF vinculada com data de processamento válida.
   */
  hasNfe: boolean;
  /**
   * `true` quando a cobertura da NF vinculada satisfaz o valor líquido do
   * pedido dentro da tolerância oficial. Vem de
   * `SalesOrderLinkedNfeContext.isFullyInvoiced`.
   */
  isFullyInvoiced?: boolean;
  /**
   * `true` quando há NF vinculada mas a cobertura é menor que o valor líquido
   * (parcial). Vem de `SalesOrderLinkedNfeContext.isPartiallyInvoiced`.
   */
  isPartiallyInvoiced?: boolean;
};

/**
 * Resolve `billingStatus` a partir do status do pedido + contexto oficial da
 * NF vinculada. Nenhuma fonte alternativa (CR, Proposta) é consultada.
 *
 * Precedência:
 *   1. Pedido inteiro cancelado → `CANCELED`.
 *   2. Sem NF vinculada           → `NOT_INVOICED`.
 *   3. `isPartiallyInvoiced`      → `PARTIALLY_INVOICED`.
 *   4. Caso contrário             → `INVOICED`.
 *
 * Observação: `isFullyInvoiced` e `isPartiallyInvoiced` são derivados por
 * `computeInvoiceCoveragePercent` (com `INVOICE_COVERAGE_TOLERANCE_*`), então
 * itens cancelados/cortados já são respeitados na fonte — este helper apenas
 * consome os flags sem recalcular.
 */
export function resolveSalesOrderBillingStatus(
  input: SalesOrderBillingStatusInput
): SalesOrderBillingStatus {
  const normalizedStatus = (input.status ?? "").trim().toUpperCase();
  if (normalizedStatus === "CANCELLED") return "CANCELED";
  if (!input.hasNfe) return "NOT_INVOICED";
  if (input.isPartiallyInvoiced === true) return "PARTIALLY_INVOICED";
  // isFullyInvoiced pode não estar definido em contextos simplificados
  // (ex.: rebuild antigo). Se há NF e não é parcial, considera INVOICED.
  return "INVOICED";
}

/** Nome curto para arquivos exportados / filtros. */
export function salesOrderBillingStatusSlug(
  status: SalesOrderBillingStatus | null | undefined
): string {
  switch (status) {
    case "INVOICED":
      return "faturado";
    case "PARTIALLY_INVOICED":
      return "parcialmente-faturado";
    case "CANCELED":
      return "cancelado";
    case "NOT_INVOICED":
      return "nao-faturado";
    default:
      return "todos";
  }
}
