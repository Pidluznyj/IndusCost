/**
 * Auditoria READ-ONLY do defeito R1 — PV com mais de uma NF-e cuja alocação em schedules
 * passa da comissão original do pedido (docs/commissions/commission-360-view.md §7.1 e §8).
 *
 * Mede, por pedido, título e item: comissão original, atribuível ao faturado, alocada,
 * realizada, liberada em fechamento, paga com vínculo comprovado e o excesso em cada etapa.
 * Pagamento sem vínculo ao título aparece como "Pagamento não atribuível ao PV" (sem valor).
 * Regras: src/lib/commissions/commissionR1Audit.ts · leitura: commissionR1Audit.server.ts.
 *
 * GARANTIAS DE SOMENTE LEITURA
 * 1. Conferência antes de qualquer leitura de negócio: banco e porta precisam ser os informados.
 * 2. Tudo roda numa transação PostgreSQL `REPEATABLE READ, READ ONLY` (o banco recusa escrita;
 *    fotografia consistente); se a sessão não ficar read-only, o script recusa.
 * 3. O cliente da transação é envolvido pela trava do processo (só leituras de modelo) e
 *    instalado em globalThis.prisma antes de importar os loaders.
 * 4. Recomendado: papel de banco só com SELECT (--require-readonly-role).
 * Não chama Nomus, sincronização, materialização, reprocesso, fechamento nem pagamento.
 * Escreve só arquivos locais num diretório novo (--out-dir), nunca sobrescreve sem --overwrite.
 *
 * Uso:
 *   npx tsx scripts/auditCommissionR1Duplication.ts --target-db=<banco> --target-port=<porta>
 *        [--out-dir=<diretório novo>] [--order-code=<PV>] [--chunk=300] [--max-orders=<n>]
 *        [--timeout-min=30] [--check-only] [--require-readonly-role] [--overwrite]
 *
 * Códigos de saída: 0 ok · 1 erro · 3 recusado (ambiente, argumentos, trava).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  CommissionAuditRefused,
  buildCommission360AuditDatabaseUrl,
  checkCommissionAuditSession,
  describeCommission360DatabaseUrl,
  runCommissionReadOnlyAudit,
} from "../src/lib/commissions/commission360ReadOnlyGuard.js";

const SOURCES = [
  "scripts/auditCommissionR1Duplication.ts",
  "src/lib/commissions/commissionR1Audit.ts",
  "src/lib/commissions/commissionR1Audit.server.ts",
  "src/lib/commissions/commission360ReadOnlyGuard.ts",
  "src/lib/commissions/commissionPortfolioOutlook.ts",
  "src/lib/commissions/commissionPortfolioOutlook.server.ts",
];

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() || null : null;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function intArg(name: string, fallback: number | null, min: number, max: number): number | null {
  const raw = arg(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new CommissionAuditRefused(`--${name} deve ser inteiro entre ${min} e ${max}.`);
  return value;
}

function sha256(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

const brl = (value: number | null) => (value == null ? "—" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const log: string[] = [];
  const out = (line = "") => {
    log.push(line);
    console.log(line);
  };
  out("Auditoria R1 — duplicação de comissão por NF-e. SOMENTE LEITURA: nenhuma tabela é alterada.");

  const url = process.env.DATABASE_URL;
  if (!url) {
    out("DATABASE_URL ausente. Rode no servidor com a base que deseja conferir.");
    return 0;
  }
  const targetDb = arg("target-db");
  const targetPort = intArg("target-port", null, 1, 65535);
  if (!targetDb || targetPort == null) throw new CommissionAuditRefused("Informe --target-db=<banco> e --target-port=<porta>.");
  const chunkSize = intArg("chunk", 300, 20, 1000)!;
  const maxOrders = intArg("max-orders", null, 1, 1_000_000);
  const timeoutMin = intArg("timeout-min", 30, 1, 180)!;
  const orderCode = arg("order-code");
  if (orderCode && !/^[\w.\-/]{1,40}$/.test(orderCode)) throw new CommissionAuditRefused("--order-code inválido.");

  let target: ReturnType<typeof describeCommission360DatabaseUrl>;
  try {
    target = describeCommission360DatabaseUrl(url);
  } catch {
    throw new CommissionAuditRefused("DATABASE_URL inválido.");
  }
  if (target.database !== targetDb) throw new CommissionAuditRefused(`DATABASE_URL aponta para ${target.database}, não para ${targetDb}.`);
  if (Number(target.port) !== targetPort) throw new CommissionAuditRefused(`DATABASE_URL usa a porta ${target.port}, não ${targetPort}.`);
  out(`Destino: host ${target.host}:${target.port} · banco ${target.database} · usuário ${target.user}${target.schema ? ` · schema ${target.schema}` : ""}`);

  const stamp = startedAt.replace(/[:.]/g, "-");
  const outDir = resolve(arg("out-dir") ?? `commission-r1-audit-${targetDb}-${stamp}`);
  if (!flag("check-only") && existsSync(outDir) && readdirSync(outDir).length > 0 && !flag("overwrite")) {
    throw new CommissionAuditRefused(`${outDir} já existe e não está vazio. Use outro --out-dir ou --overwrite.`);
  }

  const base = new PrismaClient({ datasourceUrl: buildCommission360AuditDatabaseUrl(url), log: ["warn", "error"] });
  try {
    const session = await checkCommissionAuditSession(base, {
      database: targetDb,
      port: targetPort,
      requireReadOnlyRole: flag("require-readonly-role"),
    });
    out(
      `Sessão: banco ${session.database} · usuário ${session.user} · PostgreSQL ${session.version} · porta ${session.serverPort ?? "socket"} · ` +
        `papel com escrita nas tabelas conferidas: ${session.canWrite ? "SIM (a transação READ ONLY e a trava impedem escritas)" : "não"}`
    );
    if (flag("check-only")) {
      out("--check-only: conferência concluída, nenhuma leitura de negócio feita.");
      return 0;
    }

    const today = new Date().toISOString().slice(0, 10);
    const result = await runCommissionReadOnlyAudit(
      base,
      async (guard, info) => {
        out(`Transação: isolation ${info.isolation} · transaction_read_only=${info.readOnly}`);
        (globalThis as unknown as { prisma: unknown }).prisma = guard.client;
        const audit = await import("../src/lib/commissions/commissionR1Audit.js");
        const loader = await import("../src/lib/commissions/commissionR1Audit.server.js");
        let orderIds = await loader.listR1CandidateOrderIds({ orderCode });
        const candidates = orderIds.length;
        if (maxOrders != null && orderIds.length > maxOrders) orderIds = orderIds.slice(0, maxOrders);
        out(`Pedidos com schedule vigente: ${candidates}${orderIds.length < candidates ? ` (examinados ${orderIds.length}, limite --max-orders — resultado PARCIAL)` : ""}.`);
        const sellerBatches = await loader.loadR1SellerBatches();
        const rows: ReturnType<typeof audit.auditR1Order>[] = [];
        for (let i = 0; i < orderIds.length; i += chunkSize) {
          const inputs = await loader.loadR1OrderInputs(orderIds.slice(i, i + chunkSize), today);
          for (const input of inputs) rows.push(audit.auditR1Order(input, sellerBatches));
          console.error(`  … ${Math.min(i + chunkSize, orderIds.length)}/${orderIds.length} pedidos`);
        }
        return { audit, rows, candidates, partial: orderIds.length < candidates, guard };
      },
      { timeoutMs: timeoutMin * 60_000 }
    );

    const { audit, rows } = result;
    const summary = audit.summarizeR1Audit(rows);
    const t = summary.totals;
    out("");
    out("Indicador | Valor");
    for (const [label, value] of [
      ["Pedidos comissionáveis examinados", String(t.ordersExamined)],
      ["Pedidos com múltiplas NF-e (não canceladas)", String(t.ordersWithMultipleNfes)],
      ["Pedidos com sobrealocação confirmada", String(t.ordersConfirmed)],
      ["Comissão original desses pedidos", brl(t.confirmedOrderCommission)],
      ["Comissão total alocada (desses pedidos)", brl(t.confirmedAllocated)],
      ["Excesso de comissão alocada", brl(t.confirmedOverAllocation)],
      ["Excesso já realizado", brl(t.excessRealized)],
      ["Excesso já liberado em fechamento", brl(t.excessReleased)],
      ["Excesso comprovadamente pago", brl(t.excessPaidProven)],
      ["Pedidos com pagamento não atribuível ao PV", String(t.ordersPaymentNotAttributable)],
      ["Pedidos com antecipação por faturamento parcial (suspeita de excesso, não confirmado)", `${t.ordersAnticipation} · ${brl(t.anticipationAmount)}`],
      ["Pedidos suspeitos (dados insuficientes/inconsistentes)", String(t.ordersSuspect)],
      ["Pedidos que exigem revisão", String(t.ordersNeedingReview)],
    ]) {
      out(`${label} | ${value}`);
    }
    out("");
    out("Por vendedor (confirmados): vendedor | pedidos | excesso alocado | excesso liberado | excesso pago comprovado | revisar");
    for (const row of summary.bySeller.filter((row) => row.totals.ordersNeedingReview > 0)) {
      out(
        `  ${row.sellerName} | ${row.totals.ordersConfirmed} | ${brl(row.totals.confirmedOverAllocation)} | ${brl(row.totals.excessReleased)} | ` +
          `${brl(row.totals.excessPaidProven)} | ${row.totals.ordersNeedingReview}`
      );
    }
    out("");
    out("Por mês da venda: mês | confirmados | excesso alocado | excesso realizado | excesso liberado | suspeitos | antecipação");
    for (const row of summary.byMonth) {
      out(
        `  ${row.month} | ${row.totals.ordersConfirmed} | ${brl(row.totals.confirmedOverAllocation)} | ${brl(row.totals.excessRealized)} | ` +
          `${brl(row.totals.excessReleased)} | ${row.totals.ordersSuspect} | ${brl(row.totals.anticipationAmount)}`
      );
    }

    mkdirSync(outDir, { recursive: true });
    const files: Record<string, string> = {
      "pedidos.csv": audit.buildR1OrdersCsv(rows),
      "titulos.csv": audit.buildR1TitlesCsv(rows),
      "itens.csv": audit.buildR1ItemsCsv(rows),
      "por-vendedor.csv": audit.buildR1SellerCsv(summary),
      "por-mes.csv": audit.buildR1MonthCsv(summary),
    };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(outDir, name), content, "utf8");
    out("");
    out(`Leituras: ${[...result.guard.reads.entries()].map(([op, count]) => `${op}×${count}`).join(", ")}.`);
    out(`Operações de escrita bloqueadas: ${result.guard.blocked.length}.`);
    out(`Arquivos em ${outDir}: ${Object.keys(files).join(", ")}, resumo.txt, parametros.json. Nenhum dado do banco foi alterado.`);
    writeFileSync(join(outDir, "resumo.txt"), `${log.join("\n")}\n`, "utf8");
    writeFileSync(
      join(outDir, "parametros.json"),
      JSON.stringify(
        {
          script: "auditCommissionR1Duplication",
          startedAt,
          finishedAt: new Date().toISOString(),
          target: { host: target.host, port: target.port, database: target.database, user: target.user, schema: target.schema },
          session,
          args: { targetDb, targetPort, orderCode, chunkSize, maxOrders, timeoutMin, requireReadOnlyRole: flag("require-readonly-role") },
          candidates: result.candidates,
          examined: rows.length,
          partial: result.partial,
          reads: Object.fromEntries(result.guard.reads),
          blockedOperations: result.guard.blocked,
          sources: Object.fromEntries(SOURCES.map((path) => [path, sha256(resolve(path))])),
          node: process.version,
        },
        null,
        2
      ),
      "utf8"
    );
    return result.guard.blocked.length > 0 ? 3 : 0;
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
