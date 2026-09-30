/**
 * Auditoria pura da Previsão de comissões, CR a CR (somente leitura).
 *
 * Compara a regra ANTIGA da tela — comissão atribuída − realizada pelos eventos
 * de recebimento, contando também schedules de versões substituídas do pedido —
 * com a regra NOVA: só a versão vigente do pedido, um schedule por título e
 * comissão futura proporcional ao saldo em aberto do título na origem.
 *
 * Entrega a conciliação matemática (antiga − nova = diferença removida = soma
 * das causas + não explicada), a pendência de dados (título não encontrado) e
 * os vencidos anteriores ao período que continuam em aberto.
 *
 * Não grava nada. É usada por scripts/auditCommissionOutlookOpenBalance.ts.
 */
import { roundMoney } from "./commission-money.shared.js";
import {
  buildCommissionPortfolioOutlook,
  projectCommissionPortfolioOutlookLines,
  type OutlookCards,
  type OutlookLine,
  type OutlookMonth,
  type OutlookScheduleInput,
  type OutlookTitleFacts,
} from "./commissionPortfolioOutlook.js";

export const OUTLOOK_AUDIT_CAUSES = [
  "SNAPSHOT_SUBSTITUIDO",
  "SCHEDULE_DUPLICADO",
  "EXCLUSAO_CLIENTE",
  "EMPRESA_GRUPO",
  "CANCELADO",
  "COBRANCA_SUSPENSA",
  "TITULO_NAO_ENCONTRADO",
  "TITULO_QUITADO",
  "RECEIPT_INCOMPLETO",
  "DESCONTO_ABATIMENTO",
  "SALDO_REAL_MENOR",
  "OUTRO",
] as const;

export type OutlookAuditCause = (typeof OUTLOOK_AUDIT_CAUSES)[number];

export const OUTLOOK_AUDIT_CAUSE_LABEL: Record<OutlookAuditCause, string> = {
  SNAPSHOT_SUBSTITUIDO: "schedule de versão substituída do pedido (contado de novo pela regra antiga)",
  SCHEDULE_DUPLICADO: "mais de um schedule vigente para o mesmo título",
  EXCLUSAO_CLIENTE: "cliente com regra ativa em Exceções por cliente (schedule anterior à regra)",
  EMPRESA_GRUPO: "sacado é empresa do grupo",
  CANCELADO: "título com cancelamento comprovado na origem",
  COBRANCA_SUSPENSA: "título com cobrança suspensa na origem",
  TITULO_NAO_ENCONTRADO: "título sem registro no contas a receber ou removido na origem — PENDÊNCIA DE DADOS",
  TITULO_QUITADO: "título sem saldo em aberto e sem nenhum evento de recebimento",
  RECEIPT_INCOMPLETO: "amountReceived do título maior que a soma dos eventos de recebimento",
  DESCONTO_ABATIMENTO: "título sem saldo, quitado por menos que o original (eventos = recebido do título)",
  SALDO_REAL_MENOR: "saldo em aberto menor que o original − eventos, sem recebido no título que explique",
  OUTRO: "não explicada pelas causas acima",
};

export type OutlookAuditRow = {
  fact: OutlookScheduleInput;
  title: OutlookTitleFacts | null;
  /** Linha pela regra nova. */
  line: OutlookLine;
  legacyAllocated: number;
  legacyRealized: number;
  /** Previsão da regra antiga para o título, sem filtro de período. */
  legacyForecast: number;
  receiptsSum: number;
  /** (original − saldo) − eventos recebidos. Positivo = o título baixou mais do que os eventos mostram. */
  receiptGap: number | null;
  /** O vencimento cai no período consultado (só estes entram nos totais da tela). */
  inPeriod: boolean;
  /** Venceu antes do início do período. */
  beforePeriod: boolean;
  /** Previsão antiga − previsão nova do título, sem filtro de período. */
  titleDifference: number;
  /** Previsão antiga − previsão nova, dentro do período (é o que muda na tela). */
  difference: number;
  /** Causa objetiva da diferença; null quando a previsão do título não mudou. */
  cause: OutlookAuditCause | null;
  /** Título não encontrado/removido: a comissão sai do total, mas é pendência de dados, não verdade econômica. */
  dataPending: boolean;
  /** Comissão potencial afetada pela pendência de dados (o que a regra antiga mantinha como previsto). */
  pendingPotentialCommission: number;
};

export type OutlookAuditReconciliation = {
  /** PREVISÃO REGRA ANTIGA (no período). */
  legacyForecastTotal: number;
  /** PREVISÃO REGRA NOVA (no período) — o mesmo número do card da tela. */
  newForecastTotal: number;
  /** DIFERENÇA REMOVIDA = antiga − nova. */
  removedDifference: number;
  byCause: Array<{ cause: OutlookAuditCause; label: string; count: number; difference: number }>;
  /** Soma das causas conhecidas (todas menos OUTRO). */
  explainedDifference: number;
  /** Causa OUTRO + qualquer resíduo de arredondamento: precisa ser zero para a conciliação fechar. */
  unexplainedDifference: number;
  /** removedDifference = explainedDifference + unexplainedDifference (tolerância de R$ 0,01). */
  balanced: boolean;
};

export type OutlookAudit = {
  rows: OutlookAuditRow[];
  reconciliation: OutlookAuditReconciliation;
  bySeller: Array<{ seller: string; legacy: number; next: number }>;
  /** Os universos pela regra nova, com o mesmo cálculo da tela. */
  cards: OutlookCards;
  /** Previsão mensal do período (regra nova), como na timeline da tela. */
  months: OutlookMonth[];
  /** PENDÊNCIA DE DADOS / NÃO CONCILIADO: títulos não encontrados ou removidos na origem. */
  dataPending: { count: number; potentialCommission: number; inPeriodPotentialCommission: number };
  /** Vencidos antes do início do período que continuam com saldo em aberto (fora da tela). */
  overdueBeforePeriod: { count: number; openPrincipal: number; forecast: number; legacyForecast: number };
  /** Saldo gerencial = previsão do período + vencidos anteriores ainda em aberto. */
  managerialOpenCommission: number;
};

function monthInRange(month: string | null, from: string | null, to: string | null): boolean {
  if (!month) return false;
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

/** Regra ANTIGA da tela, reproduzida só para medir a diferença. */
function legacyProjection(fact: OutlookScheduleInput, title: OutlookTitleFacts | null) {
  const excluded = ["CUSTOMER_EXCLUDED", "SUPERSEDED", "STALE", "ORPHAN", "CANCELLED"].includes(fact.scheduleStatus);
  const sellerMissing =
    !excluded &&
    (fact.sellerResolutionStatus === "NO_SELLER" ||
      fact.sellerResolutionStatus === "SELLER_UNRESOLVED" ||
      (fact.canonicalSellerId == null && fact.rawSellerId == null));
  const allocated = excluded || sellerMissing ? 0 : roundMoney(Math.max(0, fact.allocatedCommission));
  const nominal = roundMoney(Math.max(0, fact.nominalAmount));
  const seen = new Set<number>();
  let receiptsSum = 0;
  for (const receipt of fact.receipts) {
    if (seen.has(receipt.externalId)) continue;
    seen.add(receipt.externalId);
    receiptsSum = roundMoney(receiptsSum + Math.max(0, receipt.receivedAmount));
  }
  const settledWithoutReceipt = seen.size === 0 && title?.balanceRaw === 0 && roundMoney(title?.amountReceived ?? 0) > 0;
  const eligible = Math.min(receiptsSum, nominal);
  const realized =
    settledWithoutReceipt || nominal <= 0 ? 0 : roundMoney(Math.min(allocated, (allocated * eligible) / nominal));
  const forecast = settledWithoutReceipt ? 0 : roundMoney(Math.max(0, allocated - realized));
  return { allocated, realized, forecast, receiptsSum, receiptCount: seen.size };
}

function isTitleMissing(title: OutlookTitleFacts | null): boolean {
  return !title || title.balance == null;
}

/** Causa objetiva da diferença do título, na ordem em que a regra nova decide. */
function resolveCause(
  fact: OutlookScheduleInput,
  line: OutlookLine,
  title: OutlookTitleFacts | null,
  receiptsSum: number,
  receiptCount: number
): OutlookAuditCause {
  if (fact.orderSnapshotStatus !== "ACTIVE") return "SNAPSHOT_SUBSTITUIDO";
  if (line.inconsistency?.includes("mais de um schedule")) return "SCHEDULE_DUPLICADO";
  if (fact.groupCompany) return "EMPRESA_GRUPO";
  if (fact.customerExcludedByActiveRule) return "EXCLUSAO_CLIENTE";
  if (fact.titleCancelled) return "CANCELADO";
  if (fact.titleSuspended) return "COBRANCA_SUSPENSA";
  if (isTitleMissing(title)) return "TITULO_NAO_ENCONTRADO";
  // Daqui em diante a diferença vem do saldo em aberto do título.
  if (line.unreconciledCommission <= 0.01) return "OUTRO";
  const open = line.openPrincipal ?? 0;
  if (open <= 0 && receiptCount === 0) return "TITULO_QUITADO";
  if (roundMoney(title?.amountReceived ?? 0) > receiptsSum + 0.01) return "RECEIPT_INCOMPLETO";
  if (open <= 0) return "DESCONTO_ABATIMENTO";
  return "SALDO_REAL_MENOR";
}

/**
 * `facts` deve incluir os schedules de versões substituídas
 * (loadCommissionPortfolioOutlookFacts com includeSupersededSnapshots), porque a
 * regra antiga os contava.
 */
export function auditCommissionPortfolioOutlook(
  facts: readonly OutlookScheduleInput[],
  titles: ReadonlyMap<number, OutlookTitleFacts>,
  options: { fromMonth: string | null; toMonth: string | null; today: string }
): OutlookAudit {
  const { fromMonth, toMonth, today } = options;
  const newLines = new Map(projectCommissionPortfolioOutlookLines(facts, today).map((line) => [line.scheduleId, line]));

  const rows: OutlookAuditRow[] = facts.map((fact) => {
    const title = titles.get(fact.receivableId) ?? null;
    const line = newLines.get(fact.scheduleId)!;
    const legacy = legacyProjection(fact, title);
    const dueMonth = fact.dueDate ? fact.dueDate.slice(0, 7) : null;
    const inPeriod = monthInRange(dueMonth, fromMonth, toMonth);
    const titleDifference = roundMoney(legacy.forecast - line.forecastCommission);
    const settledByTitle = title ? roundMoney((title.amountReceivable ?? fact.nominalAmount) - (title.balanceRaw ?? 0)) : null;
    const changed = Math.abs(titleDifference) > 0.01;
    const cause = changed ? resolveCause(fact, line, title, legacy.receiptsSum, legacy.receiptCount) : null;
    const dataPending = cause === "TITULO_NAO_ENCONTRADO";
    return {
      fact,
      title,
      line,
      legacyAllocated: legacy.allocated,
      legacyRealized: legacy.realized,
      legacyForecast: legacy.forecast,
      receiptsSum: legacy.receiptsSum,
      receiptGap: settledByTitle == null ? null : roundMoney(settledByTitle - legacy.receiptsSum),
      inPeriod,
      beforePeriod: Boolean(fromMonth && dueMonth && dueMonth < fromMonth),
      titleDifference,
      difference: inPeriod ? titleDifference : 0,
      cause,
      dataPending,
      pendingPotentialCommission: dataPending ? legacy.forecast : 0,
    };
  });

  const sum = (pick: (row: OutlookAuditRow) => number) => roundMoney(rows.reduce((total, row) => total + pick(row), 0));
  const legacyForecastTotal = sum((row) => (row.inPeriod ? row.legacyForecast : 0));
  const newForecastTotal = sum((row) => (row.inPeriod ? row.line.forecastCommission : 0));
  const removedDifference = roundMoney(legacyForecastTotal - newForecastTotal);

  const causes = new Map<OutlookAuditCause, { count: number; difference: number }>();
  const sellers = new Map<string, { legacy: number; next: number }>();
  for (const row of rows) {
    if (row.cause && Math.abs(row.difference) > 0.01) {
      const entry = causes.get(row.cause) ?? { count: 0, difference: 0 };
      entry.count += 1;
      entry.difference = roundMoney(entry.difference + row.difference);
      causes.set(row.cause, entry);
    }
    if (!row.inPeriod) continue;
    const name =
      row.fact.canonicalSellerName ?? (row.fact.rawSellerId != null ? `Nomus ${row.fact.rawSellerId}` : "sem vendedor");
    const seller = sellers.get(name) ?? { legacy: 0, next: 0 };
    seller.legacy = roundMoney(seller.legacy + row.legacyForecast);
    seller.next = roundMoney(seller.next + row.line.forecastCommission);
    sellers.set(name, seller);
  }
  const byCause = OUTLOOK_AUDIT_CAUSES.filter((cause) => causes.has(cause)).map((cause) => ({
    cause,
    label: OUTLOOK_AUDIT_CAUSE_LABEL[cause],
    ...causes.get(cause)!,
  }));
  const explainedDifference = roundMoney(
    byCause.filter((entry) => entry.cause !== "OUTRO").reduce((total, entry) => total + entry.difference, 0)
  );
  // Tudo o que não é causa conhecida: OUTRO e diferenças de centavos que não viraram causa.
  const unexplainedDifference = roundMoney(removedDifference - explainedDifference);

  const outlook = buildCommissionPortfolioOutlook(
    facts,
    {
      fromMonth,
      toMonth,
      canonicalSellerId: null,
      customerId: null,
      orderCode: null,
      status: null,
      page: 1,
      pageSize: 1,
      ownNomusSellerId: null,
      sellerLocked: false,
    },
    today
  );

  const overdueRows = rows.filter((row) => row.beforePeriod && (row.line.openPrincipal ?? 0) > 0 && row.line.forecastCommission > 0);
  const overdueForecast = roundMoney(overdueRows.reduce((total, row) => total + row.line.forecastCommission, 0));
  const pendingRows = rows.filter((row) => row.dataPending);

  return {
    rows,
    reconciliation: {
      legacyForecastTotal,
      newForecastTotal,
      removedDifference,
      byCause,
      explainedDifference,
      unexplainedDifference,
      balanced: Math.abs(unexplainedDifference) <= 0.01,
    },
    bySeller: [...sellers].map(([seller, entry]) => ({ seller, ...entry })).sort((a, b) => b.legacy - a.legacy),
    cards: outlook.cards,
    months: outlook.months,
    dataPending: {
      count: pendingRows.length,
      potentialCommission: roundMoney(pendingRows.reduce((total, row) => total + row.pendingPotentialCommission, 0)),
      inPeriodPotentialCommission: roundMoney(
        pendingRows.reduce((total, row) => total + (row.inPeriod ? row.pendingPotentialCommission : 0), 0)
      ),
    },
    overdueBeforePeriod: {
      count: overdueRows.length,
      openPrincipal: roundMoney(overdueRows.reduce((total, row) => total + (row.line.openPrincipal ?? 0), 0)),
      forecast: overdueForecast,
      legacyForecast: roundMoney(overdueRows.reduce((total, row) => total + row.legacyForecast, 0)),
    },
    managerialOpenCommission: roundMoney(newForecastTotal + overdueForecast),
  };
}

/* ------------------------------------------------------------------ */
/*  Relatório em texto e CSV (usados pelo script read-only)             */
/* ------------------------------------------------------------------ */

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const money = (value: number) => brl(value).padStart(16);
const num = (value: number | null | undefined) => (value == null ? "" : value.toFixed(2).replace(".", ","));
const sellerOf = (row: OutlookAuditRow) =>
  row.fact.canonicalSellerName ?? (row.fact.rawSellerId != null ? `Nomus ${row.fact.rawSellerId}` : "sem vendedor");
const snapshotOf = (row: OutlookAuditRow) => (row.fact.orderSnapshotStatus === "ACTIVE" ? "vigente" : "substituído");

/** Uma linha de console com todos os campos pedidos para o CR. */
function describe(row: OutlookAuditRow): string {
  return (
    `  ${sellerOf(row)} · PV ${row.fact.orderCode} · NF ${row.fact.nfeNumber ?? "—"} · CR ${row.fact.receivableCode ?? row.fact.receivableId}` +
    ` · parcela ${row.fact.installmentNumber} · venc ${row.fact.dueDate ?? "—"}\n` +
    `      original ${num(row.title?.amountReceivable) || "—"} · balanceReceivable ${num(row.title?.balanceRaw) || "—"}` +
    ` · amountReceived ${num(row.title?.amountReceived) || "—"} · Σ receipts ${num(row.receiptsSum)}` +
    ` · status Nomus ${row.title?.nomusStatus == null ? "—" : String(row.title.nomusStatus)}\n` +
    `      schedule ${row.fact.scheduleId} · snapshot ${snapshotOf(row)} (${row.fact.orderSnapshotStatus ?? "?"})` +
    ` · atribuída ${num(row.fact.allocatedCommission)} · antiga ${num(row.legacyForecast)} · nova ${num(row.line.forecastCommission)}` +
    ` · diferença ${num(row.titleDifference)} · causa ${row.cause ?? "—"}`
  );
}

export type OutlookAuditReportContext = {
  today: string;
  fromMonth: string;
  toMonth: string | null;
  seller: string | null;
  /** Total de schedules lidos antes do filtro de vendedor. */
  totalSchedules: number;
  /** Quantos CRs listar por seção no console (o CSV traz todos). */
  top: number;
};

/** Linhas do relatório de console, na ordem de leitura. */
export function formatOutlookAuditReport(audit: OutlookAudit, context: OutlookAuditReportContext): string[] {
  const out: string[] = [];
  const { reconciliation, cards } = audit;
  const { today, fromMonth, toMonth, seller, top } = context;
  out.push(`\nData de referência: ${today} · período: ${fromMonth} a ${toMonth ?? "sem fim"} · vendedor: ${seller ?? "todos"}`);
  out.push(`Schedules lidos: ${audit.rows.length} (de ${context.totalSchedules}) · títulos: ${new Set(audit.rows.map((row) => row.fact.receivableId)).size}`);

  out.push("\n=== 1. CONCILIAÇÃO (período da tela) ===");
  out.push(`  PREVISÃO REGRA ANTIGA ............... ${money(reconciliation.legacyForecastTotal)}`);
  out.push(`− PREVISÃO REGRA NOVA ................. ${money(reconciliation.newForecastTotal)}`);
  out.push(`= DIFERENÇA REMOVIDA ................. ${money(reconciliation.removedDifference)}`);
  out.push("\n  Diferença por causa:");
  for (const entry of reconciliation.byCause) {
    if (entry.cause === "OUTRO") continue;
    out.push(`    ${entry.cause.padEnd(22)} ${money(entry.difference)} · ${String(entry.count).padStart(4)} CR(s) · ${entry.label}`);
  }
  out.push(`  SOMA DAS CAUSAS ..................... ${money(reconciliation.explainedDifference)}`);
  out.push(`  DIFERENÇA NÃO EXPLICADA (OUTRO) ..... ${money(reconciliation.unexplainedDifference)}`);
  out.push(
    `  ${reconciliation.balanced ? "PASS" : "FAIL"}: soma das causas ${reconciliation.balanced ? "=" : "≠"} diferença removida` +
      (reconciliation.balanced ? "." : " — investigar os CRs com causa OUTRO no CSV.")
  );

  out.push("\n=== 2. PREVISÃO MENSAL A PARTIR DO PERÍODO (regra nova) ===");
  for (const month of audit.months) {
    out.push(`  ${month.label}  ainda a receber ${money(month.forecast)}   já realizado (histórico) ${money(month.realized)}`);
  }
  out.push(`  TOTAL ainda a receber no período ...... ${money(cards.forecast)}`);
  out.push(`    do qual vencido e não recebido ...... ${money(cards.overdueForecast)}`);

  out.push(`\n=== 3. VENCIDOS ANTES DE ${fromMonth} AINDA EM ABERTO (fora do período da tela) ===`);
  out.push(`  ${audit.overdueBeforePeriod.count} CR(s) · saldo em aberto ${brl(audit.overdueBeforePeriod.openPrincipal)}`);
  out.push(`  Comissão ainda pendente (regra nova) .. ${money(audit.overdueBeforePeriod.forecast)}`);
  out.push(`  (regra antiga para os mesmos CRs) ..... ${money(audit.overdueBeforePeriod.legacyForecast)}`);
  out.push(`  SALDO GERENCIAL = período + vencidos anteriores = ${brl(audit.managerialOpenCommission)}`);
  for (const row of audit.rows
    .filter((item) => item.beforePeriod && item.line.forecastCommission > 0)
    .sort((a, b) => b.line.forecastCommission - a.line.forecastCommission)
    .slice(0, top)) {
    out.push(describe(row));
  }

  out.push("\n=== 4. PENDÊNCIA DE DADOS / NÃO CONCILIADO (título não encontrado ou removido na origem) ===");
  out.push("  Sai do total confiável, mas NÃO é comissão zero comprovada: precisa de conferência no Nomus.");
  out.push(`  ${audit.dataPending.count} CR(s) · comissão potencial afetada ${brl(audit.dataPending.potentialCommission)}` +
    ` (no período da tela: ${brl(audit.dataPending.inPeriodPotentialCommission)})`);
  for (const row of audit.rows.filter((item) => item.dataPending).sort((a, b) => b.pendingPotentialCommission - a.pendingPotentialCommission).slice(0, top)) {
    out.push(describe(row));
  }

  out.push("\n=== 5. OUTROS UNIVERSOS (regra nova, mesmo cálculo da tela) ===");
  out.push(`  Realizada aguardando fechamento ....... ${money(cards.awaitingClosing)}`);
  out.push(`  Liberada e ainda não paga ............. ${money(cards.balanceToPay)}`);
  out.push(`  Paga .................................. ${money(cards.paid)}`);
  out.push(`  Realizado no período (histórico) ...... ${money(cards.realized)}`);
  out.push(`  Fora da previsão (inclui pendências) .. ${money(cards.unreconciled)}`);

  out.push("\n=== 6. POR VENDEDOR (antiga → nova, no período) ===");
  for (const entry of audit.bySeller) {
    out.push(`  ${entry.seller.padEnd(36)} ${money(entry.legacy)} → ${money(entry.next)}  (removido ${brl(entry.legacy - entry.next)})`);
  }

  const divergent = audit.rows.filter((row) => Math.abs(row.difference) > 0.01).sort((a, b) => b.difference - a.difference);
  out.push(`\n=== 7. CRs DIVERGENTES NO PERÍODO: ${divergent.length} (mostrando ${Math.min(top, divergent.length)}; todos no CSV) ===`);
  for (const row of divergent.slice(0, top)) out.push(describe(row));
  return out;
}

/** CSV (separador ;) com uma linha por schedule e todas as colunas da auditoria. */
export function buildOutlookAuditCsv(audit: OutlookAudit): string {
  const header = [
    "vendedor", "pedido", "nf", "cr", "parcela", "vencimento", "valor_original", "balance_receivable",
    "amount_received_titulo", "soma_receipts", "status_nomus", "schedule_id", "status_schedule", "snapshot_pv", "status_snapshot_pv",
    "comissao_atribuida", "previsao_antiga", "previsao_nova", "diferenca_titulo", "causa", "causa_descricao",
    "no_periodo", "diferenca_no_periodo", "vencido_antes_do_periodo", "pendencia_de_dados", "comissao_potencial_pendente",
    "realizada_antiga", "realizada_nova", "fora_da_previsao", "dif_baixa_titulo_menos_receipts", "motivo_linha",
  ];
  const csv = [header.join(";")];
  for (const row of audit.rows) {
    csv.push(
      [
        sellerOf(row),
        row.fact.orderCode,
        row.fact.nfeNumber ?? "",
        row.fact.receivableCode ?? String(row.fact.receivableId),
        String(row.fact.installmentNumber),
        row.fact.dueDate ?? "",
        num(row.title?.amountReceivable),
        num(row.title?.balanceRaw),
        num(row.title?.amountReceived),
        num(row.receiptsSum),
        row.title?.nomusStatus == null ? "" : String(row.title.nomusStatus),
        row.fact.scheduleId,
        row.fact.scheduleStatus,
        snapshotOf(row),
        row.fact.orderSnapshotStatus ?? "",
        num(row.fact.allocatedCommission),
        num(row.legacyForecast),
        num(row.line.forecastCommission),
        num(row.titleDifference),
        row.cause ?? "",
        row.cause ? OUTLOOK_AUDIT_CAUSE_LABEL[row.cause] : "",
        row.inPeriod ? "sim" : "não",
        num(row.difference),
        row.beforePeriod ? "sim" : "não",
        row.dataPending ? "sim" : "não",
        num(row.pendingPotentialCommission),
        num(row.legacyRealized),
        num(row.line.realizedCommission),
        num(row.line.unreconciledCommission),
        num(row.receiptGap),
        (row.line.inconsistency ?? "").replace(/;/g, ","),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(";")
    );
  }
  return "\uFEFF" + csv.join("\r\n") + "\r\n";
}
