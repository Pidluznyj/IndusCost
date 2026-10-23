/**
 * Conferência READ-ONLY da prévia de comissão por recebimento com NF-e de N pedidos
 * (docs/commissions/commission-nn-cardinality-audit.md, Etapa B).
 *
 * Gera a prévia oficial de uma competência SEM materializar nada e lista:
 *   - títulos compartilhados por mais de um pedido (linha por pedido, recebido atribuído);
 *   - direitos não resolvidos (vínculo contraditório, schedule duplicado, sem schedule);
 *   - pedidos retidos pela guarda R1 (mesma venda em mais de uma NF-e);
 *   - recebimentos que a aplicação do fechamento recusaria (direito final + pendente);
 *   - conciliação: recebido do título uma vez, Σ por vendedor + não atribuído = total.
 *
 * GARANTIAS DE SOMENTE LEITURA (mesmo runtime das auditorias 360° e R1)
 * 1. Banco e porta conferidos antes de qualquer leitura de negócio.
 * 2. Transação PostgreSQL `REPEATABLE READ, READ ONLY`; se não ficar read-only, recusa.
 * 3. Cliente envolvido pela trava do processo (só leituras de modelo) e instalado em
 *    globalThis.prisma antes de importar os loaders.
 * Não chama Nomus, sincronização, materialização, reprocesso, fechamento nem pagamento.
 * Escreve só arquivos locais num diretório novo (--out-dir).
 *
 * Uso:
 *   npx tsx scripts/auditCommissionNnPreview.ts --target-db=<banco> --target-port=<porta>
 *        --year=2026 --month=10 [--out-dir=<diretório novo>] [--timeout-min=30]
 *        [--check-only] [--require-readonly-role] [--overwrite]
 *
 * Códigos de saída: 0 ok · 1 erro · 3 recusado (ambiente, argumentos, trava).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  CommissionAuditRefused,
  buildCommission360AuditDatabaseUrl,
  checkCommissionAuditSession,
  describeCommission360DatabaseUrl,
  runCommissionReadOnlyAudit,
} from "../src/lib/commissions/commission360ReadOnlyGuard.js";

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
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CommissionAuditRefused(`--${name} deve ser inteiro entre ${min} e ${max}.`);
  }
  return value;
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Célula CSV com ; e proteção contra fórmula. */
function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[;"\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const log: string[] = [];
  const out = (line = "") => {
    log.push(line);
    console.log(line);
  };
  out("Prévia N:N de comissão por recebimento. SOMENTE LEITURA: nenhuma tabela é alterada, nada é materializado.");

  const url = process.env.DATABASE_URL;
  if (!url) {
    out("DATABASE_URL ausente. Rode no servidor com a base que deseja conferir.");
    return 0;
  }
  const targetDb = arg("target-db");
  const targetPort = intArg("target-port", null, 1, 65535);
  const year = intArg("year", null, 2020, 2100);
  const month = intArg("month", null, 1, 12);
  const timeoutMin = intArg("timeout-min", 30, 1, 180)!;
  if (!targetDb || targetPort == null) throw new CommissionAuditRefused("Informe --target-db=<banco> e --target-port=<porta>.");
  if (year == null || month == null) throw new CommissionAuditRefused("Informe --year e --month da competência.");

  let target: ReturnType<typeof describeCommission360DatabaseUrl>;
  try {
    target = describeCommission360DatabaseUrl(url);
  } catch {
    throw new CommissionAuditRefused("DATABASE_URL inválido.");
  }
  if (target.database !== targetDb) throw new CommissionAuditRefused(`DATABASE_URL aponta para ${target.database}, não para ${targetDb}.`);
  if (Number(target.port) !== targetPort) throw new CommissionAuditRefused(`DATABASE_URL usa a porta ${target.port}, não ${targetPort}.`);
  out(`Destino: host ${target.host}:${target.port} · banco ${target.database} · usuário ${target.user} · competência ${String(month).padStart(2, "0")}/${year}`);

  const stamp = startedAt.replace(/[:.]/g, "-");
  const outDir = resolve(arg("out-dir") ?? `commission-nn-preview-${targetDb}-${year}-${String(month).padStart(2, "0")}-${stamp}`);
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
    out(`Sessão: banco ${session.database} · usuário ${session.user} · PostgreSQL ${session.version} · porta ${session.serverPort ?? "socket"}`);
    if (flag("check-only")) {
      out("--check-only: conferência concluída, nenhuma leitura de negócio feita.");
      return 0;
    }

    const result = await runCommissionReadOnlyAudit(
      base,
      async (guard, info) => {
        out(`Transação: isolation ${info.isolation} · transaction_read_only=${info.readOnly}`);
        (globalThis as unknown as { prisma: unknown }).prisma = guard.client;
        const engine = await import("../src/lib/commissions/commissionReceiptEngine.server.js");
        const closing = await import("../src/lib/commissions/commissionReceiptClosing.js");
        const rights = await import("../src/lib/commissions/commissionReceivableOrderRights.js");
        const coverage = await import("../src/lib/commissions/commissionReceiptCoverage.shared.js");
        // Sem materialização: a prévia lê só o que já está gravado.
        const preview = await engine.loadCommissionReceiptPreview({ year, month });
        return { preview, closing, rights, coverage, guard };
      },
      { timeoutMs: timeoutMin * 60_000 }
    );

    const { preview, closing, rights, coverage } = result;
    const lines = preview.lines;
    const shared = lines.filter((line) => line.financialAnchorShared === true);
    const sharedTitles = new Set(shared.map((line) => line.nomusReceivableId));
    const unresolved = lines.filter((line) => line.rightResolution && line.rightResolution !== "SCHEDULED");
    const held = lines.filter((line) => (line.auditFlags ?? []).includes(rights.COMMISSION_RIGHT_OVER_ALLOCATED_FLAG));
    const conflicts = rights.findReceiptRightConflicts(lines, coverage.isCoverageFinalLineStatus);
    const readiness = closing.assessReceiptClosingApplyReadiness(preview);
    const sellerReceived = preview.bySeller.reduce((sum, row) => sum + row.receivedAmount, 0);
    const unattributed = preview.totalUnattributedSharedReceivedAmount ?? 0;

    out("");
    out("Indicador | Valor");
    for (const [label, value] of [
      ["Títulos com recebimento na competência", String(preview.totalReceivables)],
      ["Recebido (cada título uma vez)", brl(preview.totalReceivedAmount)],
      ["Comissão liberada", brl(preview.totalReleasedCommission)],
      ["Títulos compartilhados por N pedidos", String(sharedTitles.size)],
      ["Linhas de pedido nesses títulos", String(shared.length)],
      ["Recebido de título compartilhado sem lastro para repartir", brl(unattributed)],
      ["Σ recebido por vendedor + não atribuído", brl(sellerReceived + unattributed)],
      ["Direitos não resolvidos (contraditório/duplicado/sem schedule/R1)", String(unresolved.length)],
      ["Linhas retidas pela guarda R1", `${held.length} · ${brl(held.reduce((sum, line) => sum + line.grossCommissionAmount, 0))} retidos`],
      ["Recebimentos que a aplicação recusaria (direito pendente)", String(conflicts.length)],
      ["Aplicação do fechamento", readiness.canApply ? "liberada" : `bloqueada — ${readiness.applyBlockedReason}`],
    ]) {
      out(`${label} | ${value}`);
    }

    const header = [
      "titulo", "nf", "pedido", "pedido_nomus", "vendedor", "status", "resolucao", "recebido_titulo",
      "recebido_atribuido", "atribuicao", "base", "comissao_liberada", "schedule", "snapshot", "recebimentos", "motivo",
    ];
    const toRow = (line: (typeof lines)[number]) =>
      [
        line.nomusReceivableId, line.nfeNumber, line.orderCode, line.nomusOrderId ?? "", line.canonicalSellerName ?? line.rawSellerName,
        line.status, line.rightResolution ?? "", line.receivedAmount, line.attributedReceivedAmount ?? "",
        line.financialAnchorAttribution ?? "", line.commissionableBaseAmount, line.releasedCommissionAmount,
        line.commissionReceivableScheduleId ?? "", line.orderSnapshotId ?? "", (line.receiptIds ?? []).join(" "), line.statusReason ?? "",
      ].map(csvCell).join(";");
    const sharedCsv = [header.join(";"), ...shared.map(toRow)].join("\n");
    const unresolvedCsv = [header.join(";"), ...unresolved.map(toRow)].join("\n");
    const conflictsCsv = [
      "recebimento;titulo;tipo;pedidos_finais;pedidos_pendentes",
      ...conflicts.map((row) =>
        [row.receiptExternalId, row.nomusReceivableId, row.kind, row.finalOrderCodes.join(" "),
          row.pendingRights.map((right) => `${right.orderCode ?? "—"}:${right.status}`).join(" ")].map(csvCell).join(";")
      ),
    ].join("\n");

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "titulos-compartilhados.csv"), `${sharedCsv}\n`, "utf8");
    writeFileSync(join(outDir, "direitos-nao-resolvidos.csv"), `${unresolvedCsv}\n`, "utf8");
    writeFileSync(join(outDir, "recebimentos-bloqueados.csv"), `${conflictsCsv}\n`, "utf8");
    out("");
    out(`Leituras: ${[...result.guard.reads.entries()].map(([op, count]) => `${op}×${count}`).join(", ")}.`);
    out(`Operações de escrita bloqueadas: ${result.guard.blocked.length}.`);
    out(`Arquivos em ${outDir}. Nenhum dado do banco foi alterado.`);
    writeFileSync(join(outDir, "resumo.txt"), `${log.join("\n")}\n`, "utf8");
    writeFileSync(
      join(outDir, "parametros.json"),
      JSON.stringify(
        {
          script: "auditCommissionNnPreview",
          startedAt,
          finishedAt: new Date().toISOString(),
          target: { host: target.host, port: target.port, database: target.database, user: target.user, schema: target.schema },
          session,
          args: { targetDb, targetPort, year, month, timeoutMin, requireReadOnlyRole: flag("require-readonly-role") },
          reads: Object.fromEntries(result.guard.reads),
          blockedOperations: result.guard.blocked,
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
