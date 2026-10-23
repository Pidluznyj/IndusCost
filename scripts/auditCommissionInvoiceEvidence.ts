/**
 * Auditoria READ-ONLY da evidência oficial do Nomus para o faturamento por item × NF-e
 * (B5 das comissões N:N — docs/commissions/commission-nn-cardinality-audit.md).
 *
 * Para os pedidos com NF-e processada na janela, mede:
 *   - linhas dos documentos de saída com idItemPedido, só sequência do item, só o pedido
 *     ou nenhum identificador oficial;
 *   - por pedido: evidência INEQUÍVOCA, AMBÍGUA ou AUSENTE (mesmo carregador oficial do
 *     materializador, `loadOrderInvoiceAllocation`) e o efeito B5 na comissão: histórico
 *     comprovado, alocado por NF-e ou RETIDO — com a comissão hoje programada nos
 *     snapshots ACTIVE (impacto antes de ligar a regra);
 *   - pedidos de NF-e única: como o faturamento integral foi (ou não) comprovado.
 * Nenhum vínculo é criado ou presumido; nada é materializado.
 *
 * GARANTIAS DE SOMENTE LEITURA (mesmo runtime das auditorias 360°, R1 e N:N)
 * 1. Banco e porta conferidos antes de qualquer leitura de negócio.
 * 2. Transação PostgreSQL `REPEATABLE READ, READ ONLY`; se não ficar read-only, recusa.
 * 3. Cliente envolvido pela trava do processo (só leituras de modelo) e instalado em
 *    globalThis.prisma antes de importar os loaders.
 * Escreve só arquivos locais num diretório novo (--out-dir).
 *
 * Uso:
 *   npx tsx scripts/auditCommissionInvoiceEvidence.ts --target-db=<banco> --target-port=<porta>
 *        [--from=2026-09-01] [--to=AAAA-MM-DD] [--limit=N] [--out-dir=<diretório novo>]
 *        [--timeout-min=60] [--check-only] [--require-readonly-role] [--overwrite]
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
import type { InvoiceEvidenceAuditRow, OutputDocumentLineRefKind } from "../src/lib/commissions/commissionInvoiceEvidenceAudit.js";

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

function dateArg(name: string, fallback: string): Date {
  const raw = arg(name) ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new CommissionAuditRefused(`--${name} deve ser AAAA-MM-DD.`);
  return new Date(`${raw}T00:00:00.000Z`);
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "—");

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
  out("Evidência Nomus do faturamento por item × NF-e (B5). SOMENTE LEITURA: nada é gravado, materializado ou vinculado.");

  const url = process.env.DATABASE_URL;
  if (!url) {
    out("DATABASE_URL ausente. Rode no servidor com a base que deseja conferir.");
    return 0;
  }
  const targetDb = arg("target-db");
  const targetPort = intArg("target-port", null, 1, 65535);
  const timeoutMin = intArg("timeout-min", 60, 1, 240)!;
  const limit = intArg("limit", null, 1, 1_000_000);
  const from = dateArg("from", "2026-09-01");
  const to = dateArg("to", new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  if (!targetDb || targetPort == null) throw new CommissionAuditRefused("Informe --target-db=<banco> e --target-port=<porta>.");
  if (to <= from) throw new CommissionAuditRefused("--to deve ser posterior a --from.");

  let target: ReturnType<typeof describeCommission360DatabaseUrl>;
  try {
    target = describeCommission360DatabaseUrl(url);
  } catch {
    throw new CommissionAuditRefused("DATABASE_URL inválido.");
  }
  if (target.database !== targetDb) throw new CommissionAuditRefused(`DATABASE_URL aponta para ${target.database}, não para ${targetDb}.`);
  if (Number(target.port) !== targetPort) throw new CommissionAuditRefused(`DATABASE_URL usa a porta ${target.port}, não ${targetPort}.`);
  const window = `${from.toISOString().slice(0, 10)} a ${to.toISOString().slice(0, 10)} (exclusive)`;
  out(`Destino: host ${target.host}:${target.port} · banco ${target.database} · usuário ${target.user} · NF-e processadas de ${window}`);

  const stamp = startedAt.replace(/[:.]/g, "-");
  const outDir = resolve(arg("out-dir") ?? `commission-invoice-evidence-${targetDb}-${stamp}`);
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
        const client = guard.client as unknown as PrismaClient;
        const source = await import("../src/lib/commissions/commission-source-resolver.server.js");
        const allocationServer = await import("../src/lib/commissions/commissionInvoiceAllocation.server.js");
        const audit = await import("../src/lib/commissions/commissionInvoiceEvidenceAudit.js");
        const resolver = await import("../src/lib/sales/salesOrderOutputDocumentLinkResolver.js");
        const { decimalToNumber } = await import("../src/lib/commissions/commission-money.js");

        const links = await client.salesOrderNfeLink.findMany({
          where: { dataProcessamento: { gte: from, lt: to } },
          select: { salesOrderId: true, nfeExternalId: true },
          orderBy: [{ salesOrderId: "asc" }],
        });
        const orderIds = [...new Set(links.map((link) => link.salesOrderId))].slice(0, limit ?? undefined);
        const snapshotTotals = await client.commissionOrderSnapshot.groupBy({
          by: ["salesOrderId"],
          where: { salesOrderId: { in: orderIds }, status: "ACTIVE" },
          _sum: { totalFinalCommissionAmount: true },
        });
        const activeCommission = new Map(snapshotTotals.map((row) => [row.salesOrderId, decimalToNumber(row._sum.totalFinalCommissionAmount)]));

        const rows: InvoiceEvidenceAuditRow[] = [];
        const nfeIds = new Set<number>();
        let skipped = 0;
        for (const [index, salesOrderId] of orderIds.entries()) {
          const loaded = await source.loadCommissionOrderSourceBySalesOrderId(client, salesOrderId);
          if (!loaded) {
            skipped += 1;
            continue;
          }
          const { bundle } = loaded;
          for (const nfe of bundle.linkedNfes) nfeIds.add(nfe.nfeExternalId);
          const validNfeIds = bundle.linkedNfes
            .filter((nfe) => nfe.isAuthorized && nfe.isOutputOperation && !nfe.isCancelled)
            .map((nfe) => nfe.nfeExternalId);
          if (validNfeIds.length === 0) continue;
          const allocation = await allocationServer.loadOrderInvoiceAllocation(client, bundle);
          const classification = audit.classifyOrderInvoiceEvidence(allocation, validNfeIds);
          rows.push({
            ...classification,
            salesOrderId,
            orderCode: bundle.orderCode,
            validNfeCount: validNfeIds.length,
            proofStatus: allocation.singleNfeBillingProof?.status ?? null,
            proofSource: allocation.singleNfeBillingProof?.source ?? null,
            activeSnapshotCommission: activeCommission.get(salesOrderId) ?? 0,
          });
          if ((index + 1) % 200 === 0) console.log(`  ${index + 1}/${orderIds.length} pedidos…`);
        }

        const documents = await client.nomusStockDocument.findMany({
          where: { idNfe: { in: [...nfeIds] }, isCancelled: false },
          select: { items: { select: { rawJson: true } } },
        });
        const lineKinds: Record<OutputDocumentLineRefKind, number> = { ITEM_ID: 0, ITEM_SEQUENCE: 0, ORDER_ONLY: 0, NONE: 0 };
        for (const document of documents) {
          for (const item of document.items) {
            lineKinds[audit.classifyOutputDocumentLineRefs(resolver.extractOutputDocumentOrderRefsFromRaw(item.rawJson))] += 1;
          }
        }
        return { rows, skipped, lineKinds, documents: documents.length, summary: audit.summarizeInvoiceEvidenceAudit(rows), guard };
      },
      { timeoutMs: timeoutMin * 60_000 }
    );

    const { rows, summary, lineKinds } = result;
    const totalLines = Object.values(lineKinds).reduce((sum, value) => sum + value, 0);
    out("");
    out("Linhas dos documentos de saída (não cancelados) | Quantidade | %");
    for (const [label, key] of [
      ["Com idItemPedido", "ITEM_ID"],
      ["Só sequência do item no pedido", "ITEM_SEQUENCE"],
      ["Só o pedido (idPedido/código)", "ORDER_ONLY"],
      ["Sem identificador oficial", "NONE"],
    ] as const) {
      out(`${label} | ${lineKinds[key]} | ${pct(lineKinds[key], totalLines)}`);
    }
    out(`Total | ${totalLines} linhas em ${result.documents} documentos`);
    out("");
    out("Pedidos | Quantidade | %");
    out(`Analisados (com NF-e válida) | ${summary.orders} | — (sem origem carregável: ${result.skipped})`);
    out(`Evidência inequívoca | ${summary.byClass.UNEQUIVOCAL} | ${pct(summary.byClass.UNEQUIVOCAL, summary.orders)}`);
    out(`Evidência ambígua | ${summary.byClass.AMBIGUOUS} | ${pct(summary.byClass.AMBIGUOUS, summary.orders)}`);
    out(`Sem evidência por item | ${summary.byClass.NO_EVIDENCE} | ${pct(summary.byClass.NO_EVIDENCE, summary.orders)}`);
    out(`Pedidos em mais de uma NF-e válida | ${summary.multiNfeOrders} | ${pct(summary.multiNfeOrders, summary.orders)}`);
    out("");
    out("Efeito B5 na comissão | Pedidos | Comissão hoje programada (snapshots ACTIVE)");
    out(`Histórico comprovado (pedido inteiro) | ${summary.byOutcome.LEGACY_FULL.orders} | ${brl(summary.byOutcome.LEGACY_FULL.activeSnapshotCommission)}`);
    out(`Alocado por NF-e | ${summary.byOutcome.ALLOCATED.orders} | ${brl(summary.byOutcome.ALLOCATED.activeSnapshotCommission)}`);
    out(`RETIDO até evidência | ${summary.byOutcome.HELD.orders} | ${brl(summary.byOutcome.HELD.activeSnapshotCommission)}`);
    out("");
    out("NF-e única — prova do faturamento integral | Pedidos");
    for (const [key, count] of Object.entries(summary.singleNfeProof).sort()) out(`${key} | ${count}`);

    const header = ["pedido", "pedido_id", "nfe_validas", "evidencia", "efeito", "nfe_retidas", "prova_nfe_unica", "fonte_prova", "comissao_programada", "motivos"];
    const csv = [
      header.join(";"),
      ...rows.map((row) =>
        [
          row.orderCode, row.salesOrderId, row.validNfeCount, row.evidenceClass, row.outcome, row.heldNfeIds.join(" "),
          row.proofStatus ?? "", row.proofSource ?? "", row.activeSnapshotCommission, row.reasons.join(" | "),
        ].map(csvCell).join(";")
      ),
    ].join("\n");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "pedidos.csv"), `${csv}\n`, "utf8");
    out("");
    out(`Leituras: ${[...result.guard.reads.entries()].map(([op, count]) => `${op}×${count}`).join(", ")}.`);
    out(`Operações de escrita bloqueadas: ${result.guard.blocked.length}.`);
    out(`Arquivos em ${outDir}. Nenhum dado do banco foi alterado.`);
    writeFileSync(join(outDir, "resumo.txt"), `${log.join("\n")}\n`, "utf8");
    writeFileSync(
      join(outDir, "parametros.json"),
      JSON.stringify(
        {
          script: "auditCommissionInvoiceEvidence",
          startedAt,
          finishedAt: new Date().toISOString(),
          target: { host: target.host, port: target.port, database: target.database, user: target.user, schema: target.schema },
          session,
          args: { targetDb, targetPort, from: from.toISOString(), to: to.toISOString(), limit, timeoutMin, requireReadOnlyRole: flag("require-readonly-role") },
          lineKinds,
          summary,
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
