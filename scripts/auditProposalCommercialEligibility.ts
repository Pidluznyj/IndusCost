/**
 * Relatório SOMENTE LEITURA da elegibilidade comercial das propostas (critério de aceite em homologação).
 * O cliente Prisma é envolvido por um bloqueio que recusa qualquer escrita. Não chama o Nomus.
 *
 * Uso (DATABASE_URL do ambiente; homologação primeiro):
 *   npx tsx scripts/auditProposalCommercialEligibility.ts
 *   npx tsx scripts/auditProposalCommercialEligibility.ts --code=01823 --code=01818
 *   npx tsx scripts/auditProposalCommercialEligibility.ts --json
 *
 * Mostra: propostas Nomus, quantas ficam ocultas no grid padrão (esperado no teste_bi de 29/10: 70), o
 * diagnóstico de qualidade da integração e os indicadores do ano ANTES (população inteira) e DEPOIS (população
 * comercial), além da situação de cada código pedido (ex.: CP 01823 de R$ 42.900,00 deve continuar visível).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  PROPOSAL_COMMERCIAL_METRICS_WHERE,
  PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE,
  PROPOSAL_NOMUS_SOURCE_SYSTEM,
  PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE,
  andProposalWhere,
  classifyProposalCommercialEligibility,
} from "../src/lib/proposalCommercialEligibility.js";
import { PROPOSAL_INTEGRATION_CATEGORY_LABEL } from "../src/lib/proposalIntegrationQuality.js";
import { loadProposalIntegrationQuality } from "../src/lib/proposalIntegrationQuality.server.js";

const args = process.argv.slice(2);
const codes = args.filter((a) => a.startsWith("--code=")).map((a) => a.slice("--code=".length).trim()).filter(Boolean);
const asJson = args.includes("--json");
const WRITE = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;

function readOnly<T extends object>(client: T): T {
  const guard = (target: object, path: string): object =>
    new Proxy(target, {
      get(inner, key, receiver) {
        const value = Reflect.get(inner, key, receiver);
        if (typeof key === "string" && WRITE.test(key)) {
          return () => {
            throw new Error(`Escrita bloqueada no relatório somente leitura: ${path}${key}`);
          };
        }
        if (value && typeof value === "object" && typeof key === "string" && !key.startsWith("_")) {
          return guard(value as object, `${path}${key}.`);
        }
        return typeof value === "function" ? value.bind(inner) : value;
      },
    });
  return guard(client, "") as T;
}

function host(url: string | undefined): string {
  try {
    const u = new URL(url ?? "");
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(DATABASE_URL inválido)";
  }
}

async function main() {
  const prisma = new PrismaClient();
  const db = readOnly(prisma);
  try {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const ytd = { commercialDate: { gte: yearStart } };
    const summarize = async (where: object) => {
      const [all, converted] = await Promise.all([
        db.proposal.aggregate({ where, _count: { id: true }, _sum: { totalNetValue: true, totalGrossValue: true } }),
        db.proposal.count({ where: andProposalWhere(where, { OR: [{ salesOrder: { isNot: null } }, { status: "APPROVED" }] }) }),
      ]);
      const count = all._count.id;
      const net = Number(all._sum.totalNetValue ?? 0);
      return {
        count,
        netAmount: net,
        grossAmount: Number(all._sum.totalGrossValue ?? 0),
        averageNetValue: count > 0 ? net / count : 0,
        converted,
        conversionRate: count > 0 ? (converted / count) * 100 : null,
      };
    };
    const [nomusTotal, hiddenTotal, visibleTotal, allTotal, before, after, quality] = await Promise.all([
      db.proposal.count({ where: { sourceSystem: PROPOSAL_NOMUS_SOURCE_SYSTEM } }),
      db.proposal.count({ where: PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE }),
      db.proposal.count({ where: PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE }),
      db.proposal.count(),
      summarize(ytd),
      summarize(andProposalWhere(ytd, PROPOSAL_COMMERCIAL_METRICS_WHERE)),
      loadProposalIntegrationQuality(db as never),
    ]);
    const codeRows = codes.length
      ? await db.proposal.findMany({
          where: { OR: codes.map((code) => ({ externalProposalCode: { contains: code } })) },
          select: {
            number: true,
            externalProposalCode: true,
            sourceSystem: true,
            totalNetValue: true,
            totalGrossValue: true,
            status: true,
            Customer: { select: { companyName: true } },
            salesOrder: { select: { orderCode: true } },
            _count: { select: { items: true } },
          },
          orderBy: { number: "asc" },
        })
      : [];
    const report = {
      database: host(process.env.DATABASE_URL),
      proposals: { all: allTotal, nomus: nomusTotal, visibleInDefaultGrid: visibleTotal, hiddenWithoutCommercialValue: hiddenTotal },
      gridIsComplete: visibleTotal + hiddenTotal === allTotal,
      yearToDate: { before, after },
      integrationQuality: {
        nomusZeroNet: quality.total,
        hiddenFromDefaultGrid: quality.hiddenFromDefaultGrid,
        counts: Object.fromEntries(
          Object.entries(quality.counts).map(([key, value]) => [PROPOSAL_INTEGRATION_CATEGORY_LABEL[key as keyof typeof quality.counts], value])
        ),
        items: quality.items.map((item) => ({
          code: item.externalProposalCode,
          number: item.number,
          customer: item.customerName,
          valorTotal: item.rawNetValue,
          valorTotalNfe: item.rawGrossValue,
          sourceItems: item.sourceItemCount,
          sourceItemsWithoutSku: item.sourceItemsWithoutSku,
          mappedItems: item.mappedItemCount,
          hasSalesOrder: item.hasSalesOrder,
          hidden: item.hiddenFromDefaultGrid,
          categories: item.categories,
        })),
      },
      codes: codeRows.map((row) => {
        const eligibility = classifyProposalCommercialEligibility({
          sourceSystem: row.sourceSystem,
          totalNetValue: row.totalNetValue,
          mappedItemCount: row._count.items,
          hasSalesOrder: row.salesOrder != null,
        });
        return {
          code: row.externalProposalCode,
          number: row.number,
          customer: row.Customer?.companyName ?? null,
          net: Number(row.totalNetValue),
          gross: Number(row.totalGrossValue),
          mappedItems: row._count.items,
          salesOrder: row.salesOrder?.orderCode ?? null,
          visibleByDefault: eligibility.visibleByDefault,
          countsInCommercialMetrics: eligibility.countsInCommercialMetrics,
          class: eligibility.commercialClass,
        };
      }),
    };
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    console.log(`Banco: ${report.database} (somente leitura)`);
    console.log(`Propostas: ${allTotal} · Nomus: ${nomusTotal} · visíveis no grid padrão: ${visibleTotal} · ocultas (Nomus sem valor comercial): ${hiddenTotal}`);
    console.log(`Grid + ocultas = total? ${report.gridIsComplete ? "sim" : "NÃO — investigar"}`);
    for (const [label, row] of [["ANTES (população inteira)", before], ["DEPOIS (população comercial)", after]] as const) {
      console.log(
        `${label} · ano: ${row.count} propostas · ${money(row.netAmount)} líquido · bruto ${money(row.grossAmount)} · ticket ${money(row.averageNetValue)} · convertidas ${row.converted} · conversão ${row.conversionRate == null ? "—" : `${row.conversionRate.toFixed(1)}%`}`
      );
    }
    console.log(`\nQualidade da integração (Nomus com líquido <= 0: ${quality.total}; ocultas: ${quality.hiddenFromDefaultGrid}):`);
    for (const [label, value] of Object.entries(report.integrationQuality.counts)) console.log(`  - ${label}: ${value}`);
    if (report.codes.length) {
      console.log("\nCódigos pedidos:");
      for (const row of report.codes) {
        console.log(
          `  - ${row.code} (#${row.number}) · ${row.customer ?? "—"} · líquido ${money(row.net)} · bruto ${money(row.gross)} · itens ${row.mappedItems} · PV ${row.salesOrder ?? "—"} · ${row.visibleByDefault ? "VISÍVEL" : "OCULTA"} · ${row.countsInCommercialMetrics ? "nos indicadores" : "fora dos indicadores"} · ${row.class}`
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
