/**
 * Âncora financeira de uma linha de comissão: o título (CR) na competência.
 *
 * O recebimento é um fato único. Quando o mesmo título sustenta direitos de
 * vários pedidos (NF-e com N pedidos), cada linha carrega o recebido do título
 * (fato financeiro, igual em todas) e a parcela ATRIBUÍDA ao seu pedido. Totais
 * contam o título uma vez; agrupamentos por vendedor/pedido somam só a parcela
 * atribuída — nunca o valor integral replicado para cada vendedor.
 *
 * Módulo puro e seguro para o navegador.
 */
import { roundMoney } from "./commission-money.shared.js";

export type FinancialAnchorAttribution = "ATTRIBUTED" | "UNATTRIBUTED";

export type FinancialAnchorLineFields = {
  receivedAmount: number;
  /** Título compartilhado por mais de um pedido nesta competência. */
  financialAnchorShared?: boolean | null;
  financialAnchorOrderCount?: number | null;
  /** ATTRIBUTED = parcela por pedido com lastro; UNATTRIBUTED = sem lastro para repartir. */
  financialAnchorAttribution?: FinancialAnchorAttribution | null;
  /** Parcela do recebido do título atribuível ao pedido da linha. */
  attributedReceivedAmount?: number | null;
};

export function isSharedFinancialAnchorLine(line: FinancialAnchorLineFields): boolean {
  return line.financialAnchorShared === true;
}

/**
 * Quanto do recebido a linha representa para agrupamentos por vendedor/pedido.
 * Linha de título não compartilhado: o recebido do título (dedupe por âncora fica
 * com o chamador). Compartilhado com lastro: a parcela atribuída. Sem lastro: 0 —
 * o valor fica no total do título e em "não atribuído", nunca replicado.
 */
export function attributedReceivedAmountOf(line: FinancialAnchorLineFields): number {
  if (!isSharedFinancialAnchorLine(line)) return roundMoney(line.receivedAmount);
  if (line.financialAnchorAttribution !== "ATTRIBUTED") return 0;
  return roundMoney(line.attributedReceivedAmount ?? 0);
}

/**
 * Soma o recebido de um grupo de linhas (vendedor, cliente, status…) sem
 * multiplicar o título: linhas não compartilhadas contam uma vez por âncora;
 * linhas compartilhadas somam a parcela atribuída.
 */
export function sumReceivedForLineGroup<T extends FinancialAnchorLineFields>(
  lines: readonly T[],
  anchorKey: (line: T) => string | null
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const line of lines) {
    if (isSharedFinancialAnchorLine(line)) {
      total = roundMoney(total + attributedReceivedAmountOf(line));
      continue;
    }
    const key = anchorKey(line);
    if (key != null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    total = roundMoney(total + line.receivedAmount);
  }
  return total;
}

export type OrderNfeTotalsLine = FinancialAnchorLineFields & {
  nomusReceivableId: number;
  /** Eventos de recebimento da linha: título + eventos = âncora (um título pode ter linhas de competências diferentes). */
  receiptIds?: readonly number[] | null;
  localOrderId: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  status: string;
  releasedCommissionAmount: number;
};

export type OrderNfeTotalsBucket = {
  key: string;
  lineCount: number;
  receivableCount: number;
  receivedAmount: number;
  releasedCommission: number;
};

/**
 * Totais da prévia por pedido e por NF-e sem multiplicar o recebimento: por pedido,
 * só a parcela atribuída do título compartilhado; por NF-e, cada título uma vez
 * (a NF-e é dona do título, com ou sem lastro para repartir). Comissão liberada só
 * de linhas COMMISSIONABLE.
 */
export function summarizeLinesByOrderAndNfe<T extends OrderNfeTotalsLine>(
  lines: readonly T[]
): { byOrder: OrderNfeTotalsBucket[]; byNfe: OrderNfeTotalsBucket[] } {
  const anchorOf = (line: T) => `${line.nomusReceivableId}|${[...(line.receiptIds ?? [])].sort((a, b) => a - b).join(",")}`;
  const group = (keyOf: (line: T) => string, receivedOf: (group: T[]) => number) => {
    const groups = new Map<string, T[]>();
    for (const line of lines) {
      const key = keyOf(line);
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return [...groups.entries()]
      .map(([key, members]) => ({
        key,
        lineCount: members.length,
        receivableCount: new Set(members.map((line) => line.nomusReceivableId)).size,
        receivedAmount: receivedOf(members),
        releasedCommission: roundMoney(
          members
            .filter((line) => line.status === "COMMISSIONABLE")
            .reduce((sum, line) => sum + line.releasedCommissionAmount, 0)
        ),
      }))
      .sort((a, b) => a.key.localeCompare(b.key, "pt-BR", { numeric: true }));
  };
  const byOrder = group(
    (line) => line.localOrderId ?? line.orderCode ?? "—",
    (members) => sumReceivedForLineGroup(members, anchorOf)
  );
  const byNfe = group(
    (line) => line.nfeNumber ?? "—",
    (members) => {
      const seen = new Set<string>();
      let total = 0;
      for (const line of members) {
        if (seen.has(anchorOf(line))) continue;
        seen.add(anchorOf(line));
        total = roundMoney(total + line.receivedAmount);
      }
      return total;
    }
  );
  return { byOrder, byNfe };
}
