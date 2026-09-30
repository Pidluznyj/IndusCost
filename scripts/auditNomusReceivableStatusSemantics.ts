/**
 * Auditoria READ-ONLY do significado de `NomusAccountsReceivable.status`.
 *
 * 1. Matriz dos títulos por status × saldo × recebido × baixa × recebimentos ×
 *    suspensão × presença na origem (cálculo em
 *    src/lib/commissions/nomusReceivableStatusAudit.ts).
 * 2. Conferência de inversão: coluna `status` × valor bruto `rawPayload.status`.
 * 3. Ficha completa dos CRs informados (coluna, payload bruto e recebimentos).
 *
 * SOMENTE LEITURA: só `findMany`, `count` e `groupBy`. Não grava nada — nem no
 * banco, nem em arquivo.
 *
 * Uso (no servidor, com DATABASE_URL da base a conferir):
 *
 *   npx tsx scripts/auditNomusReceivableStatusSemantics.ts [--ids=7434,7651,7204,7319,7732,7573]
 *
 * `--ids` aceita id do título no Nomus (externalId), número da NF de origem ou
 * código do CR no schedule de comissão. Sem `--ids`, usa a lista padrão e
 * completa até 20 títulos com CRs em aberto de comissão.
 */
import { prisma } from "../src/lib/prisma.js";
import { toCivilDateKey } from "../src/lib/financeCivilDate.js";
import {
  buildReceivableStatusMatrix,
  formatReceivableStatusMatrix,
  type ReceivableStatusAuditRow,
} from "../src/lib/commissions/nomusReceivableStatusAudit.js";

const DEFAULT_IDS = ["7434", "7651", "7204", "7319", "7732", "7573"];
const MIN_SAMPLE = 20;
const RAW_FIELDS = [
  "status",
  "saldoReceber",
  "valorReceber",
  "valorRecebido",
  "valorBaixadoSemNumerario",
  "dataBaixa",
  "dataVencimento",
  "suspenderCobranca",
  "classificacao",
  "tipo",
];

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() || null : null;
}

const toNumber = (value: unknown): number | null => (value == null ? null : Number(value));

async function main() {
  console.log("NomusAccountsReceivable.status — auditoria de significado. SOMENTE LEITURA: nada é gravado.");
  console.log("Lê (findMany/count/groupBy): NomusAccountsReceivable, NomusReceivableReceipt, CommissionReceivableSchedule.");
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL ausente. Rode no servidor com a base que deseja conferir.");
    return;
  }

  // ── 1. Matriz ──────────────────────────────────────────────────────────
  const [titles, receiptGroups] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({
      select: {
        externalId: true,
        status: true,
        suspendCollection: true,
        sourcePresenceStatus: true,
        amountReceivable: true,
        amountReceived: true,
        balanceReceivable: true,
        settlementDate: true,
        dueDate: true,
      },
    }),
    prisma.nomusReceivableReceipt.groupBy({ by: ["receivableExternalId"], _count: { _all: true } }),
  ]);
  const receiptCount = new Map(receiptGroups.map((group) => [group.receivableExternalId, group._count._all]));
  const rows: ReceivableStatusAuditRow[] = titles.map((row) => ({
    externalId: row.externalId,
    status: row.status,
    suspendCollection: row.suspendCollection,
    sourcePresenceStatus: row.sourcePresenceStatus,
    amountReceivable: toNumber(row.amountReceivable),
    amountReceived: toNumber(row.amountReceived),
    balanceReceivable: toNumber(row.balanceReceivable),
    settlementDate: toCivilDateKey(row.settlementDate),
    dueDate: toCivilDateKey(row.dueDate),
    receiptCount: receiptCount.get(row.externalId) ?? 0,
  }));
  console.log("\n=== 1. MATRIZ POR STATUS ===");
  for (const line of formatReceivableStatusMatrix(buildReceivableStatusMatrix(rows))) console.log(line);

  // ── 2. O sincronizador inverteu ou normalizou o valor? ─────────────────
  console.log("\n=== 2. COLUNA status × VALOR BRUTO rawPayload.status ===");
  for (const column of [true, false]) {
    for (const raw of [true, false]) {
      const count = await prisma.nomusAccountsReceivable.count({
        where: { status: column, rawPayload: { path: ["status"], equals: raw } },
      });
      console.log(`  coluna=${column} · bruto=${raw} ......... ${count}${column !== raw && count > 0 ? "  <-- DIVERGÊNCIA" : ""}`);
    }
  }
  const nullColumn = await prisma.nomusAccountsReceivable.count({ where: { status: null } });
  console.log(`  coluna=null ......................... ${nullColumn}`);

  // ── 3. Ficha dos CRs conhecidos ────────────────────────────────────────
  const requested = (arg("ids") ?? DEFAULT_IDS.join(",")).split(",").map((item) => item.trim()).filter(Boolean);
  const numeric = requested.filter((item) => /^\d+$/.test(item)).map(Number);
  const scheduleHits = await prisma.commissionReceivableSchedule.findMany({
    where: { receivableCode: { in: requested } },
    select: { receivableId: true },
  });
  const wanted = new Set<number>(scheduleHits.map((row) => row.receivableId));
  const direct = await prisma.nomusAccountsReceivable.findMany({
    where: { OR: [{ externalId: { in: numeric } }, { sourceInvoiceNumber: { in: requested } }] },
    select: { externalId: true },
  });
  for (const row of direct) wanted.add(row.externalId);
  if (wanted.size < MIN_SAMPLE) {
    // Completa a amostra com títulos de comissão ainda em aberto, dos dois valores de status.
    const extra = await prisma.commissionReceivableSchedule.findMany({
      where: { status: "ACTIVE", orderSnapshot: { status: "ACTIVE" } },
      select: { receivableId: true },
      orderBy: { createdAt: "desc" },
      take: 400,
    });
    const byId = new Map(rows.map((row) => [row.externalId, row]));
    for (const wantedStatus of [false, true]) {
      for (const row of extra) {
        if (wanted.size >= MIN_SAMPLE) break;
        if (byId.get(row.receivableId)?.status === wantedStatus) wanted.add(row.receivableId);
      }
    }
  }

  const sample = await prisma.nomusAccountsReceivable.findMany({
    where: { externalId: { in: [...wanted] } },
    orderBy: { externalId: "asc" },
    select: {
      externalId: true,
      sourceInvoiceNumber: true,
      personName: true,
      status: true,
      suspendCollection: true,
      sourcePresenceStatus: true,
      dueDate: true,
      settlementDate: true,
      amountReceivable: true,
      amountReceived: true,
      balanceReceivable: true,
      modifiedAtNomus: true,
      syncedAt: true,
      rawPayload: true,
    },
  });
  const sampleReceipts = await prisma.nomusReceivableReceipt.findMany({
    where: { receivableExternalId: { in: sample.map((row) => row.externalId) } },
    orderBy: [{ receivableExternalId: "asc" }, { receiptDate: "asc" }],
    select: { receivableExternalId: true, receiptDate: true, receivedAmount: true, closesReceivable: true, discountAmount: true, lateFeeInterestAmount: true },
  });

  console.log(`\n=== 3. FICHA DE ${sample.length} CR(s) (pedidos: ${requested.join(", ")}) ===`);
  for (const row of sample) {
    const raw = (row.rawPayload ?? {}) as Record<string, unknown>;
    console.log(`\nCR ${row.externalId} · NF ${row.sourceInvoiceNumber ?? "—"} · ${row.personName ?? "—"}`);
    console.log(
      `  coluna: status=${row.status} · suspendCollection=${row.suspendCollection} · presença=${row.sourcePresenceStatus}` +
        ` · vencimento=${toCivilDateKey(row.dueDate) ?? "—"} · baixa=${toCivilDateKey(row.settlementDate) ?? "—"}`
    );
    console.log(
      `  valores: original=${toNumber(row.amountReceivable)} · recebido=${toNumber(row.amountReceived)} · saldo=${toNumber(row.balanceReceivable)}` +
        ` · modificado no Nomus=${row.modifiedAtNomus?.toISOString() ?? "—"} · sincronizado=${row.syncedAt.toISOString()}`
    );
    console.log(`  bruto:  ${RAW_FIELDS.map((field) => `${field}=${JSON.stringify(raw[field] ?? null)}`).join(" · ")}`);
    const receipts = sampleReceipts.filter((item) => item.receivableExternalId === row.externalId);
    console.log(
      receipts.length === 0
        ? "  receipts: nenhum"
        : `  receipts: ${receipts
            .map((item) => `${toCivilDateKey(item.receiptDate)} ${toNumber(item.receivedAmount)}${item.closesReceivable ? " (baixa)" : ""}`)
            .join(" · ")}`
    );
  }
  console.log("\nNenhum dado foi alterado.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
