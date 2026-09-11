/**
 * Evidências de homologação de CRM > Relatórios — SOMENTE LEITURA.
 *
 * Rodar NO SERVIDOR DA HOMOLOGAÇÃO, depois do deploy oficial, na pasta da app
 * (usa o DATABASE_URL já existente — não altera .env, Nomus nem dados):
 *
 *   npx tsx scripts/homolog-crm-reports-evidence.ts
 *   npx tsx scripts/homolog-crm-reports-evidence.ts --user=gestora@empresa.com --user=vendedor@empresa.com
 *   npx tsx scripts/homolog-crm-reports-evidence.ts --today=2026-09-11 --runs=5 --out=tmp/evidencias.md
 *
 * Gera um Markdown com: reconciliação × Pedidos de Venda (universo inteiro +
 * amostra por perfil), recompra conferida à mão × endpoint, EXCLUDE/ONLY
 * (universo, cards, listas e arquivo exportado), escopo por usuário real,
 * desempenho (tempo, payload, round-trips, consultas SQL) e construtor.
 * Sai com código 1 se qualquer seção reprovar.
 *
 * Garantias: conexão única em sessão `default_transaction_read_only`
 * (conferida no início e no fim), `statement_timeout`, só SELECT. As
 * consultas por status abaixo só ESCOLHEM casos de teste (clientes com pedido
 * ERROR/CANCELLED); a regra de compra continua sendo a canônica.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppUser } from "@prisma/client";
import { toAppAuthContext } from "../src/lib/auth/appAuth.server.ts";
import { enrichAppAuthSellerCommercialLink } from "../src/lib/crmSellerIdentityConsolidation.ts";
import { crmCanonicalSalesOrderWhere } from "../src/lib/commercial/crmCanonicalSalesOrderScope.server.ts";
import { crmEligibleCustomerWhere } from "../src/lib/commercial/crmManagementOrderFacts.server.ts";
import { createPrismaCrmReportsDataSource } from "../src/lib/commercial/crmReportsOperationalService.server.ts";
import { isValidBusinessDate } from "../src/lib/commercial/crmRepurchaseEngine.ts";
import {
  collectCrmReportsHomologEvidence,
  type CrmReportsEvidenceUser,
} from "../src/lib/commercial/crmReportsHomologEvidence.server.ts";
import {
  assertReadOnlySession,
  openReadOnlyAuditPrisma,
} from "../src/lib/commercial/crmReportsReadOnlyPrisma.server.ts";

function parseArgs(argv: string[]) {
  const all = (name: string) => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  const one = (name: string) => all(name)[0] ?? null;
  const today = one("today");
  if (today != null && !isValidBusinessDate(today)) throw new Error(`--today inválido (YYYY-MM-DD): ${today}`);
  const runs = Number(one("runs") ?? "3");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return {
    today,
    runs: Number.isInteger(runs) && runs > 0 ? runs : 3,
    users: all("user").flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()).filter(Boolean),
    out: one("out") ?? `tmp/crm-reports-homolog-evidence-${stamp}.md`,
  };
}

/** `--today` vira meio-dia local desse dia (o relatório trabalha em dia civil). */
function referenceNow(today: string | null): Date {
  if (!today) return new Date();
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** E-mail mascarado no relatório (o arquivo pode circular na equipe). */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${(local ?? "").slice(0, 2)}***@${domain ?? ""}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { prisma, queryCount } = await openReadOnlyAuditPrisma();
  try {
    // Casos de teste por status do pedido (seleção de amostra, não regra).
    const canonical = crmCanonicalSalesOrderWhere({ allYears: true }, { ignorePeriod: true });
    const [errorRows, cancelledRows] = await Promise.all([
      prisma.salesOrder.findMany({
        where: { AND: [canonical, { status: "ERROR" }] },
        select: { customerId: true },
        distinct: ["customerId"],
        take: 50,
      }),
      prisma.salesOrder.findMany({
        where: { status: "CANCELLED", Customer: { is: crmEligibleCustomerWhere() } },
        select: { customerId: true },
        distinct: ["customerId"],
        take: 50,
      }),
    ]);

    // Usuários reais: os informados ou 1 ativo por papel + perfis com carteira própria.
    const picked: AppUser[] = [];
    if (args.users.length > 0) {
      picked.push(
        ...(await prisma.appUser.findMany({
          where: { OR: args.users.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
        }))
      );
    } else {
      for (const role of ["ADMIN", "COMMERCIAL_MANAGER", "SELLER", "VIEWER"] as const) {
        picked.push(...(await prisma.appUser.findMany({ where: { isActive: true, role }, orderBy: { createdAt: "asc" }, take: 1 })));
      }
      picked.push(
        ...(await prisma.appUser.findMany({
          where: { isActive: true, permissions: { has: "crm.seller.own" }, role: { notIn: ["ADMIN", "SUPER_ADMIN", "COMMERCIAL_MANAGER"] } },
          orderBy: { createdAt: "asc" },
          take: 2,
        }))
      );
    }
    const users: CrmReportsEvidenceUser[] = [];
    for (const user of picked) {
      // Mesmo caminho da requisição real: toAppAuthContext + vínculo comercial.
      const auth = await enrichAppAuthSellerCommercialLink(
        toAppAuthContext(user, { id: "homolog-evidence", permissionsVersionAtIssue: user.permissionsVersion })
      );
      users.push({ label: `${user.role} · ${maskEmail(user.email)}`, auth });
    }

    const report = await collectCrmReportsHomologEvidence({
      prisma: prisma as never,
      dataSource: createPrismaCrmReportsDataSource(prisma),
      now: referenceNow(args.today),
      statusSamples: {
        errorCustomerIds: errorRows.map((r) => r.customerId),
        cancelledCustomerIds: cancelledRows.map((r) => r.customerId),
      },
      users,
      performanceRuns: args.runs,
      queryCount,
    });
    await assertReadOnlySession(prisma);

    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${report.markdown}\nSessão somente leitura conferida no início e no fim.\n`, "utf8");
    for (const section of report.sections) console.log(`${section.status.padEnd(4)}  ${section.title}`);
    console.log(`\n${report.approved ? "APROVADO" : "REPROVADO"} — evidências em ${args.out}`);
    if (!report.approved) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Falha nas evidências:", error);
  process.exitCode = 1;
});
