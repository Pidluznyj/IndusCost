/**
 * Auditoria pura do campo `NomusAccountsReceivable.status` (somente leitura).
 *
 * O campo vem de `contasReceber.status` do Nomus sem inversão nem
 * normalização (`asBoolean(raw.status)`). Esta matriz cruza o booleano com os
 * sinais econômicos do próprio título — saldo, recebido, baixa, recebimentos —
 * para mostrar, nos dados reais, o que `true` e `false` significam.
 *
 * Usada por scripts/auditNomusReceivableStatusSemantics.ts.
 */

export type ReceivableStatusAuditRow = {
  externalId: number;
  status: boolean | null;
  suspendCollection: boolean | null;
  sourcePresenceStatus: string | null;
  amountReceivable: number | null;
  amountReceived: number | null;
  balanceReceivable: number | null;
  /** Dia civil da baixa (AAAA-MM-DD) ou null. */
  settlementDate: string | null;
  dueDate: string | null;
  /** Quantidade de eventos em NomusReceivableReceipt para o título. */
  receiptCount: number;
};

export type ReceivableStatusBucket = {
  /** "true" | "false" | "null". */
  status: string;
  titles: number;
  openBalanceTotal: number;
  amountReceivableTotal: number;
  amountReceivedTotal: number;
  balancePositive: number;
  balanceZeroOrLess: number;
  balanceNull: number;
  receivedPositive: number;
  receivedZero: number;
  withSettlementDate: number;
  withoutSettlementDate: number;
  withReceipt: number;
  withoutReceipt: number;
  suspended: number;
  bySourcePresence: Record<string, number>;
  /** Em aberto de fato: saldo > 0, nada recebido, sem baixa e sem recebimento. */
  fullyOpen: number;
  /** Liquidado de fato: saldo <= 0 e (baixa preenchida ou algo recebido). */
  settled: number;
  /** Parcial: saldo > 0 com algo recebido. */
  partiallyReceived: number;
  /** Até cinco ids por situação, para conferência no Nomus. */
  examples: { fullyOpen: number[]; settled: number[]; partiallyReceived: number[]; other: number[] };
};

export type ReceivableStatusVerdict =
  | "FALSE_MEANS_OPEN"
  | "FALSE_MEANS_SETTLED"
  | "INCONCLUSIVE";

export type ReceivableStatusMatrix = {
  totalTitles: number;
  buckets: ReceivableStatusBucket[];
  /** Leitura dos dados: o que `status = false` descreve na prática. */
  verdict: ReceivableStatusVerdict;
  verdictReason: string;
};

const round = (value: number) => Math.round(value * 100) / 100;
const share = (part: number, total: number) => (total > 0 ? part / total : 0);

function emptyBucket(status: string): ReceivableStatusBucket {
  return {
    status,
    titles: 0,
    openBalanceTotal: 0,
    amountReceivableTotal: 0,
    amountReceivedTotal: 0,
    balancePositive: 0,
    balanceZeroOrLess: 0,
    balanceNull: 0,
    receivedPositive: 0,
    receivedZero: 0,
    withSettlementDate: 0,
    withoutSettlementDate: 0,
    withReceipt: 0,
    withoutReceipt: 0,
    suspended: 0,
    bySourcePresence: {},
    fullyOpen: 0,
    settled: 0,
    partiallyReceived: 0,
    examples: { fullyOpen: [], settled: [], partiallyReceived: [], other: [] },
  };
}

export function buildReceivableStatusMatrix(rows: readonly ReceivableStatusAuditRow[]): ReceivableStatusMatrix {
  const buckets = new Map<string, ReceivableStatusBucket>();
  for (const key of ["false", "true", "null"]) buckets.set(key, emptyBucket(key));

  for (const row of rows) {
    const bucket = buckets.get(row.status === null ? "null" : String(row.status))!;
    const balance = row.balanceReceivable;
    const received = row.amountReceived ?? 0;
    bucket.titles += 1;
    bucket.openBalanceTotal = round(bucket.openBalanceTotal + Math.max(0, balance ?? 0));
    bucket.amountReceivableTotal = round(bucket.amountReceivableTotal + (row.amountReceivable ?? 0));
    bucket.amountReceivedTotal = round(bucket.amountReceivedTotal + received);
    if (balance == null) bucket.balanceNull += 1;
    else if (balance > 0) bucket.balancePositive += 1;
    else bucket.balanceZeroOrLess += 1;
    if (received > 0) bucket.receivedPositive += 1;
    else bucket.receivedZero += 1;
    if (row.settlementDate) bucket.withSettlementDate += 1;
    else bucket.withoutSettlementDate += 1;
    if (row.receiptCount > 0) bucket.withReceipt += 1;
    else bucket.withoutReceipt += 1;
    if (row.suspendCollection === true) bucket.suspended += 1;
    const presence = row.sourcePresenceStatus ?? "null";
    bucket.bySourcePresence[presence] = (bucket.bySourcePresence[presence] ?? 0) + 1;

    const open = balance != null && balance > 0;
    let kind: keyof ReceivableStatusBucket["examples"] = "other";
    if (open && received <= 0 && !row.settlementDate && row.receiptCount === 0) {
      bucket.fullyOpen += 1;
      kind = "fullyOpen";
    } else if (open && received > 0) {
      bucket.partiallyReceived += 1;
      kind = "partiallyReceived";
    } else if (balance != null && balance <= 0 && (row.settlementDate != null || received > 0)) {
      bucket.settled += 1;
      kind = "settled";
    }
    if (bucket.examples[kind].length < 5) bucket.examples[kind].push(row.externalId);
  }

  const falseBucket = buckets.get("false")!;
  const trueBucket = buckets.get("true")!;
  const falseOpenShare = share(falseBucket.balancePositive, falseBucket.titles);
  const trueSettledShare = share(trueBucket.balanceZeroOrLess, trueBucket.titles);
  const falseSettledShare = share(falseBucket.balanceZeroOrLess, falseBucket.titles);
  const trueOpenShare = share(trueBucket.balancePositive, trueBucket.titles);
  const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")}%`;

  let verdict: ReceivableStatusVerdict = "INCONCLUSIVE";
  let verdictReason =
    "Os dados não separam os dois valores de forma nítida (ou um dos grupos está vazio): conferir os exemplos no Nomus antes de usar o campo.";
  if (falseBucket.titles > 0 && trueBucket.titles > 0 && falseOpenShare >= 0.9 && trueSettledShare >= 0.9) {
    verdict = "FALSE_MEANS_OPEN";
    verdictReason =
      `status=false: ${pct(falseOpenShare)} com saldo em aberto; status=true: ${pct(trueSettledShare)} sem saldo. ` +
      "O campo descreve BAIXA (true = baixado, false = em aberto), não cancelamento.";
  } else if (falseBucket.titles > 0 && trueBucket.titles > 0 && falseSettledShare >= 0.9 && trueOpenShare >= 0.9) {
    verdict = "FALSE_MEANS_SETTLED";
    verdictReason =
      `status=false: ${pct(falseSettledShare)} sem saldo; status=true: ${pct(trueOpenShare)} com saldo em aberto. ` +
      "O campo seria o inverso de baixa (true = em aberto).";
  }

  return {
    totalTitles: rows.length,
    buckets: ["false", "true", "null"].map((key) => buckets.get(key)!),
    verdict,
    verdictReason,
  };
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Linhas do relatório de console da matriz. */
export function formatReceivableStatusMatrix(matrix: ReceivableStatusMatrix): string[] {
  const out: string[] = [];
  out.push(`Títulos em NomusAccountsReceivable: ${matrix.totalTitles}`);
  for (const bucket of matrix.buckets) {
    out.push("");
    out.push(`status=${bucket.status}`);
    out.push(`  total de títulos ................ ${bucket.titles}`);
    if (bucket.titles === 0) continue;
    out.push(`  saldo em aberto total ........... ${brl(bucket.openBalanceTotal)}`);
    out.push(`  valor original total ............ ${brl(bucket.amountReceivableTotal)}`);
    out.push(`  valor recebido total ............ ${brl(bucket.amountReceivedTotal)}`);
    out.push(`  balance > 0 / <= 0 / nulo ....... ${bucket.balancePositive} / ${bucket.balanceZeroOrLess} / ${bucket.balanceNull}`);
    out.push(`  amountReceived > 0 / = 0 ........ ${bucket.receivedPositive} / ${bucket.receivedZero}`);
    out.push(`  settlementDate com / sem ........ ${bucket.withSettlementDate} / ${bucket.withoutSettlementDate}`);
    out.push(`  com receipt / sem receipt ....... ${bucket.withReceipt} / ${bucket.withoutReceipt}`);
    out.push(`  suspendCollection = true ........ ${bucket.suspended}`);
    out.push(
      `  sourcePresenceStatus ............ ${Object.entries(bucket.bySourcePresence)
        .map(([key, count]) => `${key}: ${count}`)
        .join(" · ")}`
    );
    out.push(`  em aberto de fato ............... ${bucket.fullyOpen}  (ex.: ${bucket.examples.fullyOpen.join(", ") || "—"})`);
    out.push(`  parcialmente recebido ........... ${bucket.partiallyReceived}  (ex.: ${bucket.examples.partiallyReceived.join(", ") || "—"})`);
    out.push(`  liquidado de fato ............... ${bucket.settled}  (ex.: ${bucket.examples.settled.join(", ") || "—"})`);
    out.push(`  outras combinações (ex.) ........ ${bucket.examples.other.join(", ") || "—"}`);
  }
  out.push("");
  out.push(`LEITURA DOS DADOS: ${matrix.verdict}`);
  out.push(`  ${matrix.verdictReason}`);
  return out;
}
