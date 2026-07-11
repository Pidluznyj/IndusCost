/**
 * Validação read-only — Funil Pedido → Caixa (dados reais do banco).
 *
 * Não grava. Não cria migration. Não altera UI.
 *
 * Uso:
 *   npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts
 *   npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts --customer "BRITANIA" --verbose
 *   npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts --seller "Ana" --from 2026-01-01 --to 2026-12-31 --dateAxis ORDER_ISSUE_DATE --limit 200
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import { loadOrderToCashFunnelList } from "../src/lib/sales/salesOrderToCashFunnelApi.server.ts";
import type { OrderToCashFunnelListRow } from "../src/lib/sales/salesOrderToCashFunnelApi.ts";

type CliOptions = {
  customer: string | null;
  seller: string | null;
  from: string | null;
  to: string | null;
  dateAxis: string | null;
  limit: number;
  verbose: boolean;
};

type Check = { name: string; pass: boolean; detail: string };

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    customer: null,
    seller: null,
    from: null,
    to: null,
    dateAxis: null,
    limit: 200,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    if (a === "--customer" && next) {
      opts.customer = next;
      i++;
    } else if (a === "--seller" && next) {
      opts.seller = next;
      i++;
    } else if (a === "--from" && next) {
      opts.from = next;
      i++;
    } else if (a === "--to" && next) {
      opts.to = next;
      i++;
    } else if (a === "--dateAxis" && next) {
      opts.dateAxis = next;
      i++;
    } else if (a === "--limit" && next) {
      const n = Number.parseInt(next, 10);
      if (Number.isFinite(n) && n > 0) opts.limit = Math.min(n, 500);
      i++;
    } else if (a === "--verbose" || a === "-v") {
      opts.verbose = true;
    }
  }
  return opts;
}

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function money(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function hasDownstreamEvidence(row: OrderToCashFunnelListRow): boolean {
  const fin = String(row.financialStatus ?? "");
  const op = String(row.operationalStatus ?? "");
  if (fin === "FIN_RECEBIDO" || fin === "FIN_CR_ABERTO" || fin === "FIN_FATURADO_SEM_CR") {
    return true;
  }
  if (op.startsWith("OP_") && op !== "OP_NAO_ATENDIDO") return true;
  if (row.funnelStage === "RECEBIDO" || row.funnelStage === "CR_ABERTO") return true;
  if (
    row.funnelStage === "NF_SEM_CR" ||
    row.funnelStage === "DOCUMENTO_SEM_NF" ||
    row.funnelStage === "PEDIDO_PARCIALMENTE_ATENDIDO" ||
    row.funnelStage === "PEDIDO_TOTALMENTE_ATENDIDO" ||
    row.funnelStage === "PEDIDO_ATENDIDO_COM_EXCEDENTE"
  ) {
    return true;
  }
  return false;
}

function looksOldWithoutEvidence(row: OrderToCashFunnelListRow): boolean {
  if (hasDownstreamEvidence(row)) return false;
  const issue = row.issueDate;
  if (!issue) return false;
  const today = new Date();
  const [y, m, d] = issue.slice(0, 10).split("-").map(Number);
  const issued = new Date(y!, m! - 1, d!);
  const days = Math.round((today.getTime() - issued.getTime()) / 86_400_000);
  // alinhado a diasAntigoCritico (90) do motor
  return days >= 90;
}

function printCheck(c: Check, verbose: boolean) {
  const mark = c.pass ? "PASS" : "FAIL";
  console.log(`- ${c.name}: ${mark}${verbose || !c.pass ? ` — ${c.detail}` : ""}`);
}

async function main() {
  const opts = parseCli(process.argv.slice(2));

  console.log("=== Funil Pedido → Caixa — Validação ===");
  console.log(
    `Período: ${opts.from ?? "—"} → ${opts.to ?? "—"} (dateAxis=${opts.dateAxis ?? "—"})`
  );
  if (opts.customer) console.log(`Cliente filtro: ${opts.customer}`);
  if (opts.seller) console.log(`Vendedor filtro: ${opts.seller}`);
  console.log(`Limit: ${opts.limit}`);
  console.log("");

  const query: Record<string, unknown> = {
    page: "1",
    pageSize: String(opts.limit),
  };
  if (opts.customer) query.cliente = opts.customer;
  if (opts.seller) query.vendedor = opts.seller;
  if (opts.from) query.dateFrom = opts.from;
  if (opts.to) query.dateTo = opts.to;
  if (opts.dateAxis) query.dateAxis = opts.dateAxis;

  let payload: Awaited<ReturnType<typeof loadOrderToCashFunnelList>>;
  try {
    payload = await loadOrderToCashFunnelList(query);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const friendly = /Can't reach database|P1001|ECONNREFUSED|localhost:5432/i.test(raw)
      ? "Banco indisponível (não foi possível conectar). Rode no servidor com DATABASE_URL válido e run SUCCESS da Conciliação."
      : raw.replace(/\s+/g, " ").slice(0, 240);
    console.error("Falha ao carregar funil do banco (read-only):", friendly);
    console.log("");
    console.log("Validações PASS/FAIL:");
    console.log("- cargaBanco: FAIL — " + friendly);
    console.log("");
    console.log("PASS/FAIL: FAIL");
    process.exitCode = 1;
    return;
  }

  const rows = payload.rows;
  const totalValue = round2(rows.reduce((s, r) => s + Number(r.orderValue || 0), 0));
  const stageValueSum = round2(
    payload.funnelStages.reduce((s, st) => s + Number(st.value || 0), 0)
  );

  console.log(`Pedidos analisados: ${payload.pagination.totalItems} (página=${rows.length})`);
  console.log(`Valor total (orderValue na página): ${money(totalValue)}`);
  console.log(`Valor estágios (analytics filtrado): ${money(stageValueSum)}`);
  if (payload.message) console.log(`Aviso: ${payload.message}`);
  if (payload.dataFreshness?.runId) {
    console.log(
      `Run: ${payload.dataFreshness.runId} | latest=${payload.dataFreshness.isLatestRun}`
    );
  }
  console.log("");

  console.log("Estágios:");
  for (const st of payload.funnelStages.filter((s) => s.count > 0)) {
    console.log(
      `  - ${st.stage}: n=${st.count} valor=${money(st.value)} confMéd=${st.confidenceAvg ?? "—"}`
    );
  }
  console.log("");

  console.log("Temperaturas:");
  for (const t of payload.temperatureSummary.filter((x) => x.count > 0)) {
    console.log(`  - ${t.temperature}: n=${t.count} valor=${money(t.value)}`);
  }
  console.log("");

  console.log("Top riscos:");
  const top = payload.riskSummary.topRisks.slice(0, 10);
  if (top.length === 0) {
    console.log("  (nenhum)");
  } else {
    for (const r of top) {
      console.log(
        `  - ${r.orderCode ?? r.orderId} | ${r.funnelStage} | ${money(r.value)} | ${r.reason}`
      );
    }
  }
  console.log("");

  const checks: Check[] = [];

  // 1) estágio principal único
  const idCounts = new Map<string, number>();
  for (const row of rows) {
    idCounts.set(row.salesOrderId, (idCounts.get(row.salesOrderId) ?? 0) + 1);
  }
  const dupIds = [...idCounts.entries()].filter(([, n]) => n > 1);
  checks.push({
    name: "stagePrincipalUnico",
    pass: dupIds.length === 0,
    detail:
      dupIds.length === 0
        ? `Cada um dos ${rows.length} pedidos da página aparece uma vez.`
        : `Duplicados: ${dupIds.map(([id]) => id).slice(0, 5).join(", ")}`,
  });

  // 2) sem duplicidade Pedido+NF+CR (um valueForStage por pedido; soma estágios = analytics)
  const rowStageSum = round2(rows.reduce((s, r) => {
    const st = payload.funnelStages.find((x) => x.stage === r.funnelStage);
    return s; // only structural — use totals
  }, 0));
  void rowStageSum;
  const exclusiveStages = payload.funnelStages.filter(
    (s) => s.stage !== "CANCELADO" && s.stage !== "CLIENTE_COM_HISTORICO"
  );
  const exclusiveSum = round2(exclusiveStages.reduce((s, st) => s + st.value, 0));
  const totalsOk =
    Math.abs(exclusiveSum - Number(payload.totals.activeStageValueSum || 0)) <= 0.05;
  checks.push({
    name: "semDuplicidadePedidoNfCr",
    pass: totalsOk && dupIds.length === 0,
    detail: totalsOk
      ? `Soma estágios exclusivos=${money(exclusiveSum)} = totals.activeStageValueSum (sem somar Pedido+NF+CR).`
      : `Divergência: estágios=${money(exclusiveSum)} vs totals=${money(Number(payload.totals.activeStageValueSum || 0))}`,
  });

  // 3) alertas não somam carteira
  const noteOk = /não duplicam|não somam|referência/i.test(payload.riskSummary.note ?? "");
  const excessRef = Number(payload.riskSummary.valorComExcesso || 0);
  const stageSumWithoutAlertInflation = exclusiveSum;
  checks.push({
    name: "alertasNaoSomamCarteira",
    pass: noteOk,
    detail: noteOk
      ? `Nota de risco ok; valorComExcesso (ref)=${money(excessRef)}; carteira por estágio=${money(stageSumWithoutAlertInflation)}.`
      : "riskSummary.note não declara que alertas não duplicam carteira.",
  });

  // 4–5) proposta / comissão — fonte de código
  const apiSrc = readSrc("src/lib/sales/salesOrderToCashFunnelApi.ts");
  const serverSrc = readSrc("src/lib/sales/salesOrderToCashFunnelApi.server.ts");
  const classSrc = readSrc("src/lib/sales/salesOrderToCashFunnelClassification.ts");
  const analyticsSrc = readSrc("src/lib/sales/salesOrderToCashFunnelAnalytics.ts");
  const payloadJson = JSON.stringify(payload);
  const proposalOk =
    !/from\s+["'][^"']*proposal/i.test(apiSrc + serverSrc + classSrc + analyticsSrc) &&
    !/ProposalStatus|salesFunnel\.ts/.test(apiSrc + serverSrc) &&
    !/"proposalId"\s*:/.test(payloadJson) &&
    !/fonte oficial.*proposta/i.test(payloadJson);
  checks.push({
    name: "propostaNaoUsadaComoFonteOficial",
    pass: proposalOk,
    detail: proposalOk
      ? "Motores/API sem import de Proposal; payload sem proposalId."
      : "Detectada referência indevida a proposta.",
  });

  const commissionOk =
    !/from\s+["'][^"']*comiss/i.test(apiSrc + serverSrc + classSrc + analyticsSrc) &&
    !/from\s+["'][^"']*commission/i.test(apiSrc + serverSrc + classSrc + analyticsSrc) &&
    !/CommissionOrderSnapshot|estimatedCommission/.test(payloadJson);
  checks.push({
    name: "comissaoNaoUsada",
    pass: commissionOk,
    detail: commissionOk
      ? "Sem imports/campos de comissão no funil."
      : "Detectada referência a comissão.",
  });

  // 6) pedidos antigos sem evidência → BLOQUEADO
  const oldCandidates = rows.filter(looksOldWithoutEvidence);
  const oldMisclassified = oldCandidates.filter(
    (r) => r.funnelStage !== "BLOQUEADO_REVISAO" && r.funnelStage !== "SEM_EVIDENCIA"
  );
  checks.push({
    name: "pedidoAntigoSemEvidenciaBloqueado",
    pass: oldMisclassified.length === 0,
    detail:
      oldCandidates.length === 0
        ? "Sem candidatos (≥90 dias sem evidência) no conjunto."
        : oldMisclassified.length === 0
          ? `${oldCandidates.length} candidato(s) em BLOQUEADO/SEM_EVIDENCIA.`
          : `Mal classificados: ${oldMisclassified
              .map((r) => `${r.orderCode}:${r.funnelStage}`)
              .slice(0, 5)
              .join(", ")}`,
  });

  // 7) CR aberto
  const crRows = rows.filter(
    (r) =>
      r.funnelStage === "CR_ABERTO" ||
      r.financialStatus === "FIN_CR_ABERTO" ||
      r.alerts.includes("CR_VENCIDO")
  );
  const crMis = rows.filter(
    (r) => r.financialStatus === "FIN_CR_ABERTO" && r.funnelStage !== "CR_ABERTO" && r.funnelStage !== "RECEBIDO"
  );
  checks.push({
    name: "crAbertoClassificado",
    pass: crMis.length === 0,
    detail:
      crRows.length === 0 && crMis.length === 0
        ? "Sem CR aberto no conjunto."
        : crMis.length === 0
          ? `${crRows.filter((r) => r.funnelStage === "CR_ABERTO").length} pedido(s) em CR_ABERTO.`
          : `FIN_CR_ABERTO fora de CR_ABERTO: ${crMis.map((r) => r.orderCode).slice(0, 5).join(", ")}`,
  });

  // 8) Recebido
  const recMis = rows.filter(
    (r) => r.financialStatus === "FIN_RECEBIDO" && r.funnelStage !== "RECEBIDO"
  );
  const recOk = rows.filter((r) => r.funnelStage === "RECEBIDO");
  checks.push({
    name: "recebidoClassificado",
    pass: recMis.length === 0,
    detail:
      recOk.length === 0 && recMis.length === 0
        ? "Sem recebidos no conjunto."
        : recMis.length === 0
          ? `${recOk.length} pedido(s) RECEBIDO.`
          : `FIN_RECEBIDO fora de RECEBIDO: ${recMis.map((r) => r.orderCode).slice(0, 5).join(", ")}`,
  });

  // 9) Documento/NF sem CR
  const docNfStages = new Set(["DOCUMENTO_SEM_NF", "NF_SEM_CR"]);
  const docNfRows = rows.filter((r) => docNfStages.has(r.funnelStage));
  const fiscalWithoutCrMis = rows.filter(
    (r) =>
      r.financialStatus === "FIN_FATURADO_SEM_CR" &&
      r.funnelStage !== "NF_SEM_CR" &&
      r.funnelStage !== "DOCUMENTO_SEM_NF" &&
      // atendimento operacional pode ter prioridade abaixo de NF; se há NF status fiscal, deveria ser NF_SEM_CR
      !(
        r.funnelStage === "PEDIDO_TOTALMENTE_ATENDIDO" ||
        r.funnelStage === "PEDIDO_PARCIALMENTE_ATENDIDO" ||
        r.funnelStage === "PEDIDO_ATENDIDO_COM_EXCEDENTE"
      )
  );
  checks.push({
    name: "documentoSemCrClassificado",
    pass: fiscalWithoutCrMis.length === 0,
    detail:
      docNfRows.length === 0 && fiscalWithoutCrMis.length === 0
        ? "Sem Doc/NF sem CR no conjunto (ou só atendimento operacional)."
        : fiscalWithoutCrMis.length === 0
          ? `${docNfRows.length} pedido(s) em DOCUMENTO_SEM_NF/NF_SEM_CR.`
          : `FIN_FATURADO_SEM_CR inconsistente: ${fiscalWithoutCrMis
              .map((r) => `${r.orderCode}:${r.funnelStage}`)
              .slice(0, 5)
              .join(", ")}`,
  });

  // 10) payload com explicações
  const cardsMissingExpl = payload.summaryCards.filter(
    (c) => !c.explanation || String(c.explanation).trim().length < 8
  );
  checks.push({
    name: "payloadComExplicacoes",
    pass: payload.summaryCards.length >= 10 && cardsMissingExpl.length === 0,
    detail:
      cardsMissingExpl.length === 0
        ? `${payload.summaryCards.length} cards com explanation.`
        : `Cards sem explanation: ${cardsMissingExpl.map((c) => c.key).join(", ")}`,
  });

  // 11) sem JSON cru
  const rawLeak =
    /nomusRawResponse|PrismaClient|"traceJson"\s*:\s*\{|"rawPayload"/i.test(payloadJson) ||
    /stack trace|at Object\./i.test(payloadJson);
  checks.push({
    name: "semJsonCru",
    pass: !rawLeak,
    detail: !rawLeak
      ? "Payload sem nomusRaw/Prisma/trace cru."
      : "Possível vazamento de JSON cru no payload.",
  });

  // Extra útil: top riscos presentes quando há bloqueados
  const blockedValue = Number(payload.riskSummary.valorBloqueado || 0);
  const topRisksOk =
    blockedValue <= 0.01 ||
    payload.riskSummary.topRisks.some((r) => r.funnelStage === "BLOQUEADO_REVISAO");
  checks.push({
    name: "topRiscos",
    pass: topRisksOk,
    detail: topRisksOk
      ? `topRisks=${payload.riskSummary.topRisks.length}; valorBloqueado=${money(blockedValue)}.`
      : "Há valor bloqueado mas topRisks não lista BLOQUEADO_REVISAO.",
  });

  console.log("Validações PASS/FAIL:");
  for (const c of checks) printCheck(c, opts.verbose);

  const failed = checks.filter((c) => !c.pass);
  const overall = failed.length === 0 ? "PASS" : "FAIL";
  console.log("");
  console.log(`PASS/FAIL: ${overall}`);
  if (failed.length) {
    console.log(`Falhas (${failed.length}): ${failed.map((f) => f.name).join(", ")}`);
  }

  if (opts.verbose && rows.length) {
    console.log("");
    console.log("Amostra de rows (até 8):");
    for (const r of rows.slice(0, 8)) {
      console.log(
        `  ${r.orderCode} | ${r.funnelStage} | ${r.temperature} | conf=${r.confidenceScore} | ${money(r.orderValue)} | alerts=${r.alerts.join(",") || "—"}`
      );
    }
  }

  if (overall === "FAIL") process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Erro inesperado na validação:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
  });
