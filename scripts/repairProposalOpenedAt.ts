/**
 * Reparo de `Proposal.externalOpenedAt` invertido (MM/DD lido como DD/MM).
 *
 * PREVIEW é o padrão e NÃO escreve. O apply exige token explícito.
 *
 *   npm run repair:proposal-opened-at:dry
 *   npm run repair:proposal-opened-at:apply
 *
 * A fonte da verdade é `externalRawPayload.dataHoraAbertura`, preservado na
 * importação. Nada é apagado: apenas `externalOpenedAt` é reescrito, e só
 * quando o payload permite decidir com certeza.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  decideProposalOpenedAtRepair,
  summarizeProposalOpenedAtRepair,
  type ProposalOpenedAtRepairDecision,
} from "../src/lib/proposalOpenedAtRepair.ts";

const APPLY_TOKEN = "REPAIR_PROPOSAL_OPENED_AT";
const BATCH_SIZE = 500;

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function flagValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function fmt(date: string | null): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

async function main(): Promise<void> {
  const apply = hasFlag("--apply");
  const asJson = hasFlag("--json");
  const confirm = flagValue("--confirm-apply");
  const limitRaw = flagValue("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;

  if (apply && confirm !== APPLY_TOKEN) {
    console.error(
      `[repair:proposal-opened-at] apply exige --confirm-apply=${APPLY_TOKEN}`
    );
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaClient();
  const decisions: ProposalOpenedAtRepairDecision[] = [];
  let repaired = 0;
  const errors: Array<{ id: string; message: string }> = [];

  try {
    const rows = await prisma.proposal.findMany({
      where: { sourceSystem: { not: null } },
      select: {
        id: true,
        externalProposalCode: true,
        sourceSystem: true,
        externalOpenedAt: true,
        externalRawPayload: true,
      },
      orderBy: { externalProposalCode: "asc" },
      ...(limit && Number.isFinite(limit) && limit > 0 ? { take: limit } : {}),
    });

    for (const row of rows) decisions.push(decideProposalOpenedAtRepair(row));

    const toRepair = decisions.filter(
      (d): d is Extract<ProposalOpenedAtRepairDecision, { kind: "REPAIR" }> =>
        d.kind === "REPAIR"
    );

    if (apply && toRepair.length > 0) {
      // Lotes pequenos em transação: falha de um lote não deixa o conjunto
      // meio gravado sem que o erro apareça no relatório.
      for (let i = 0; i < toRepair.length; i += BATCH_SIZE) {
        const batch = toRepair.slice(i, i + BATCH_SIZE);
        try {
          await prisma.$transaction(
            batch.map((d) =>
              prisma.proposal.update({
                where: { id: d.id },
                data: { externalOpenedAt: d.correctValue },
              })
            )
          );
          repaired += batch.length;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          for (const d of batch) errors.push({ id: d.id, message });
        }
      }
    }

    const summary = summarizeProposalOpenedAtRepair(decisions);
    const report = {
      mode: apply ? "apply" : "preview",
      ...summary,
      repaired: apply ? repaired : 0,
      errorCount: errors.length,
      errors: errors.slice(0, 20),
      sample: toRepair.slice(0, 20).map((d) => ({
        code: d.code,
        raw: d.rawText,
        de: d.storedCivilDate,
        para: d.correctCivilDate,
        inversaoDiaMes: d.isDayMonthSwap,
      })),
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `\n[repair:proposal-opened-at] modo=${report.mode}  analisadas=${summary.analyzed}`
      );
      console.log(`  já corretas .............. ${summary.okCount}`);
      console.log(`  a reparar ................ ${summary.repairCount}`);
      console.log(`    dessas, inversão dia/mês  ${summary.dayMonthSwapCount}`);
      console.log(`  ignoradas ................ ${summary.skipCount}`);
      for (const [reason, count] of Object.entries(summary.skipReasons)) {
        console.log(`    - ${reason}: ${count}`);
      }
      if (apply) {
        console.log(`  REPARADAS ................ ${repaired}`);
        console.log(`  erros .................... ${errors.length}`);
      }
      if (report.sample.length > 0) {
        console.log("\n  amostra:");
        for (const s of report.sample) {
          console.log(
            `    ${s.code ?? "—"}  payload="${s.raw}"  ${fmt(s.de)} → ${fmt(s.para)}${s.inversaoDiaMes ? "  [inversão dia/mês]" : ""}`
          );
        }
      }
      if (!apply && summary.repairCount > 0) {
        console.log(
          `\n  PREVIEW — nada foi gravado. Para aplicar:\n    npm run repair:proposal-opened-at:apply\n`
        );
      }
    }

    // Erro nunca vira sucesso silencioso.
    if (errors.length > 0) process.exitCode = 3;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[repair:proposal-opened-at] falhou:", err);
  process.exitCode = 1;
});
