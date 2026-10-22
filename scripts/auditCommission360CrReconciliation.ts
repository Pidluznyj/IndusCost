/**
 * Auditoria READ-ONLY — conciliação inversa CR → comissão (Visão 360°).
 *
 * Parte de TODOS os títulos do contas a receber com vencimento no período (não dos
 * schedules) e classifica cada um pela cadeia oficial CR → NF-e → PV → snapshot →
 * schedule, com a comissão futura do motor oficial da Previsão. Responde, para
 * novembro e dezembro de 2026, por que CRs relevantes não aparecem na previsão, e
 * marca PVs cuja alocação em schedules passa da comissão do pedido (risco R1).
 *
 * Regras: src/lib/commissions/commission360View.ts · leitura: commission360View.server.ts.
 *
 * GARANTIAS DE SOMENTE LEITURA
 * 1. Conferência antes de qualquer leitura de negócio (SELECT de catálogo): banco (e porta, se
 *    informada) precisam ser os do DATABASE_URL e os de --target-db/--target-port.
 * 2. Leituras numa transação PostgreSQL REPEATABLE READ, READ ONLY (o banco recusa escrita).
 * 3. Trava no processo: o cliente da transação, envolvido por createCommission360ReadOnlyPrisma,
 *    é instalado em globalThis.prisma ANTES de importar os loaders.
 * 4. Recomendado: papel de banco só com SELECT (ver --require-readonly-role).
 * A única escrita é o CSV local (nunca sobrescreve sem --overwrite).
 *
 * Uso (no servidor, com DATABASE_URL da base que se quer conferir):
 *
 *   npx tsx scripts/auditCommission360CrReconciliation.ts --target-db=<nome do banco> [--target-port=<porta>]
 *        [--from=2026-11] [--to=2026-12] [--top=30] [--csv=caminho.csv] [--overwrite]
 *        [--check-only] [--require-readonly-role]
 *
 * --target-db é obrigatório e precisa ser igual a current_database(): evita rodar na base errada.
 * --check-only só mostra o destino e os privilégios e encerra.
 * Códigos de saída: 0 ok · 1 erro · 3 recusado (ambiente, argumentos ou trava).
 */
import { existsSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  CommissionAuditRefused,
  buildCommission360AuditDatabaseUrl,
  checkCommissionAuditSession,
  describeCommission360DatabaseUrl,
  runCommissionReadOnlyAudit,
} from "../src/lib/commissions/commission360ReadOnlyGuard.js";

const READS = [
  "NomusAccountsReceivable (títulos do período e títulos irmãos da mesma NF-e)",
  "SalesOrderNfeLink (+ SalesOrder)",
  "CommissionOrderSnapshot (+ itens, Customer)",
  "CommissionReceivableSchedule (todas as versões) + NomusReceivableReceipt + CommissionReceiptCoverage + CommissionPaymentSchedule",
  "CommissionCustomerExclusionRule",
];

const MAX_MONTHS = 24;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

class Refused extends CommissionAuditRefused {}

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() || null : null;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let month = from; month <= to; ) {
    out.push(month);
    const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
    month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return out;
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main(): Promise<number> {
  console.log("Visão 360° — conciliação CR → comissão. SOMENTE LEITURA: nenhuma tabela é alterada.");
  console.log(`Lê (findMany): ${READS.join("; ")}.`);

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL ausente. Rode no servidor com a base que deseja conferir.");
    return 0;
  }
  const fromMonth = arg("from") ?? "2026-11";
  const toMonth = arg("to") ?? "2026-12";
  if (!MONTH_RE.test(fromMonth) || !MONTH_RE.test(toMonth) || fromMonth > toMonth) {
    throw new Refused("Use --from=AAAA-MM e --to=AAAA-MM (from ≤ to).");
  }
  const months = monthsBetween(fromMonth, toMonth);
  if (months.length > MAX_MONTHS) throw new Refused(`Período máximo de ${MAX_MONTHS} meses por execução (memória).`);
  const topRaw = Number(arg("top") ?? 30);
  if (!Number.isInteger(topRaw) || topRaw < 1 || topRaw > 500) throw new Refused("--top deve ser inteiro entre 1 e 500.");
  const targetDb = arg("target-db");
  if (!targetDb) throw new Refused("Informe --target-db=<nome do banco> (precisa ser igual ao banco do DATABASE_URL).");
  const portRaw = arg("target-port");
  const targetPort = portRaw == null ? null : Number(portRaw);
  if (targetPort != null && (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)) {
    throw new Refused("--target-port inválido.");
  }

  let target: ReturnType<typeof describeCommission360DatabaseUrl>;
  try {
    target = describeCommission360DatabaseUrl(url);
  } catch {
    throw new Refused("DATABASE_URL inválido.");
  }
  console.log(
    `Destino: host ${target.host}:${target.port} · banco ${target.database} · usuário ${target.user}` +
      (target.schema ? ` · schema ${target.schema}` : "")
  );

  if (target.database !== targetDb) throw new Refused(`DATABASE_URL aponta para ${target.database}, não para ${targetDb}.`);
  if (targetPort != null && Number(target.port) !== targetPort) throw new Refused(`DATABASE_URL usa a porta ${target.port}, não ${targetPort}.`);

  const base = new PrismaClient({ datasourceUrl: buildCommission360AuditDatabaseUrl(url), log: ["warn", "error"] });
  try {
    // Única SQL própria: SELECT de catálogo de conferência, antes de qualquer leitura de negócio.
    const session = await checkCommissionAuditSession(base, {
      database: targetDb,
      port: targetPort,
      requireReadOnlyRole: flag("require-readonly-role"),
    });
    console.log(
      `Sessão: banco ${session.database} · usuário ${session.user} · PostgreSQL ${session.version} · porta ${session.serverPort ?? "socket"} · ` +
        `papel com escrita nas tabelas conferidas: ${session.canWrite ? "SIM (a transação READ ONLY e a trava impedem escritas)" : "não"}`
    );
    if (flag("check-only")) {
      console.log("--check-only: conferência concluída, nenhuma leitura de negócio feita.");
      return 0;
    }

    const today = new Date().toISOString().slice(0, 10);
    const csvPath = arg("csv") ?? `commission-360-cr-reconciliation-${fromMonth}-${toMonth}-${today}.csv`;
    if (existsSync(csvPath) && !flag("overwrite")) throw new Refused(`${csvPath} já existe. Use --overwrite ou outro --csv.`);

    // Transação READ ONLY + trava do processo; os loaders reaproveitam globalThis.prisma (src/lib/prisma.ts).
    const { view, rows, guard, COMMISSION_360_CR_STATUS_META } = await runCommissionReadOnlyAudit(
      base,
      async (guard, info) => {
        console.log(`Transação: isolation ${info.isolation} · transaction_read_only=${info.readOnly}`);
        (globalThis as unknown as { prisma: unknown }).prisma = guard.client;
        const view = await import("../src/lib/commissions/commission360View.js");
        const { loadCommission360Receivables } = await import("../src/lib/commissions/commission360View.server.js");
        const { COMMISSION_360_CR_STATUS_META } = await import("../src/lib/commissions/commission360View.shared.js");
        const inputs = await loadCommission360Receivables({ fromMonth, toMonth }, today);
        return { view, rows: inputs.map(view.classifyCommission360Receivable), guard, COMMISSION_360_CR_STATUS_META };
      },
      { timeoutMs: 30 * 60_000 }
    );
    const diagnostic = view.buildCommission360Diagnostic(rows, months);
    const funnel = view.buildCommission360Funnel(rows);

    console.log(`\nData de referência: ${today} · vencimento ${fromMonth} a ${toMonth} · ${rows.length} título(s).`);
    const lines: Array<[string, (col: (typeof diagnostic)[number]) => string]> = [
      ["Quantidade de CRs", (col) => String(col.crCount)],
      ["Saldo financeiro em aberto", (col) => brl(col.openBalance)],
      ["Saldo elegível identificado", (col) => brl(col.eligibleBalance)],
      ["Saldo coberto por schedule", (col) => brl(col.coveredBalance)],
      ["Saldo sem schedule / sem cobertura", (col) => brl(col.uncoveredBalance)],
      ["Saldo excluído legitimamente", (col) => brl(col.excludedBalance)],
      ["Comissão alocada", (col) => brl(col.allocatedCommission)],
      ["Comissão futura calculada", (col) => brl(col.forecastCommission)],
      ["Comissão potencial sem cobertura confirmada", (col) => brl(col.potentialUncoveredCommission)],
      ["Diferenças de conciliação (saldo)", (col) => brl(col.differenceBalance)],
      ["Comissão futura de PVs com alocação acima do pedido (R1)", (col) => brl(col.forecastOnOverAllocatedOrders)],
      ["Excesso de alocação dos PVs (R1, não conciliado)", (col) => brl(col.orderOverAllocationExcess)],
    ];
    console.log(["Indicador", ...diagnostic.map((col) => col.label)].join(" | "));
    for (const [label, pick] of lines) console.log([label, ...diagnostic.map(pick)].join(" | "));

    console.log("\nPor classificação (período inteiro):");
    for (const row of diagnostic.at(-1)!.byStatus) {
      console.log(`  ${COMMISSION_360_CR_STATUS_META[row.status].label}: ${row.count} CR(s) · ${brl(row.openBalance)}`);
    }
    console.log(
      `\nFunil: CRs operacionais ${funnel.operationalCount} (${brl(funnel.operationalBalance)}) → comissionáveis ` +
        `${funnel.commissionableCount} (${brl(funnel.commissionableBalance)}) → cobertos ${funnel.coveredCount} ` +
        `(${brl(funnel.coveredBalance)}) → comissão futura ${brl(funnel.forecastCommission)} · diferenças ` +
        `${funnel.differenceCount} (${brl(funnel.differenceBalance)})`
    );

    const top = topRaw;
    const gaps = rows
      .filter((row) => (row.group === "SEM_COBERTURA" || row.group === "DIVERGENCIA") && (row.openBalance ?? 0) > 0)
      .sort((a, b) => (b.openBalance ?? 0) - (a.openBalance ?? 0))
      .slice(0, top);
    console.log(`\nMaiores títulos sem cobertura ou com divergência (top ${top}):`);
    for (const row of gaps) {
      console.log(
        `  CR ${row.receivableId} · NF ${row.invoiceNumber ?? "—"} · venc. ${row.dueDate ?? "—"} · ${row.customerName ?? "—"} · ` +
          `PV ${row.orderCode ?? "—"} · saldo ${brl(row.openBalance ?? 0)} · ${COMMISSION_360_CR_STATUS_META[row.status].label}` +
          (row.potentialUncoveredCommission != null ? ` · potencial ${brl(row.potentialUncoveredCommission)}` : "")
      );
    }
    const overAllocated = new Map<string, { orderCode: string | null; excess: number }>();
    for (const row of rows) {
      if ((row.orderOverAllocatedCommission ?? 0) > 0.01 && row.salesOrderId) {
        overAllocated.set(row.salesOrderId, { orderCode: row.orderCode, excess: row.orderOverAllocatedCommission! });
      }
    }
    console.log(`\nPVs com alocação em schedules acima da comissão do pedido (R1): ${overAllocated.size}`);
    for (const [id, value] of [...overAllocated.entries()].sort((a, b) => b[1].excess - a[1].excess).slice(0, top)) {
      console.log(`  PV ${value.orderCode ?? id} · excesso ${brl(value.excess)}`);
    }

    writeFileSync(csvPath, `﻿${view.buildCommission360ReceivablesCsv(rows)}`, "utf8");
    const readSummary = [...guard.reads.entries()].map(([op, count]) => `${op}×${count}`).join(", ");
    console.log(`\nLeituras feitas: ${readSummary}.`);
    console.log(`Operações de escrita bloqueadas: ${guard.blocked.length}.`);
    console.log(`Detalhe título a título gravado em ${csvPath} (${rows.length} linha(s)). Nenhum dado do banco foi alterado.`);
    return guard.blocked.length > 0 ? 3 : 0;
  } finally {
    await base.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof CommissionAuditRefused) {
      console.error(`Recusado: ${error.message}`);
      process.exitCode = 3;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
