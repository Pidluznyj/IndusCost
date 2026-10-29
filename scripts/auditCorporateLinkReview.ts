/**
 * Relatório SOMENTE LEITURA da revisão de vínculo empresarial de um cliente (ex.: VICLA × GODOI & CARDOSO).
 * Não grava nada: o cliente Prisma é envolvido por um bloqueio que recusa qualquer escrita
 * (create, update, upsert, delete, $executeRaw, $transaction). Não chama bureau nem protesto externo pago
 * (a consulta externa fica desligada: env vazio).
 *
 * Uso (com o DATABASE_URL do ambiente, homologação primeiro):
 *   npx tsx scripts/auditCorporateLinkReview.ts --customer=<uuid>
 *   npx tsx scripts/auditCorporateLinkReview.ts --cnpj=66913253000164
 *   npx tsx scripts/auditCorporateLinkReview.ts --cnpj=66913253000164 --json
 *
 * Mostra: decisão individual e consolidada, motivo, indícios pendentes (tipo, fonte, confiabilidade),
 * relacionadas confirmadas (formais e manuais), histórico rejeitado/encerrado, linhas de CustomerCorporateLink
 * das duas direções e as últimas entradas de auditoria CORPORATE_LINK_*.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { formatCnpj, normalizeCnpj } from "../src/lib/companyCnpjFormat.js";
import { readCommercialCreditDecision } from "../src/lib/commercial/commercialCreditDecision.server.js";

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const asJson = args.includes("--json");

const WRITE = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;

/** Recusa qualquer escrita: o relatório pode rodar em produção sem risco de gravar. */
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
  const customerArg = arg("customer");
  const cnpjArg = arg("cnpj");
  if (!customerArg && !cnpjArg) {
    console.error("uso: npx tsx scripts/auditCorporateLinkReview.ts --customer=<uuid> | --cnpj=<14 dígitos> [--json]");
    process.exit(2);
  }
  const prisma = new PrismaClient();
  const db = readOnly(prisma);
  try {
    const cnpj = cnpjArg ? normalizeCnpj(cnpjArg) : null;
    const customer = customerArg
      ? await db.customer.findUnique({ where: { id: customerArg }, select: { id: true, companyName: true, taxId: true } })
      : await db.customer.findFirst({
          where: { taxId: { in: [cnpj!, formatCnpj(cnpj!)] } },
          select: { id: true, companyName: true, taxId: true },
        });
    if (!customer) {
      console.error("Cliente não encontrado.");
      process.exit(1);
    }
    const decision = await readCommercialCreditDecision(db as never, {
      customerId: customer.id,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      externalProtestQuery: { env: {} },
    });
    const links = await db.customerCorporateLink.findMany({
      where: { OR: [{ customerId: customer.id }, { relatedCustomerId: customer.id }] },
      orderBy: { updatedAt: "desc" },
    });
    const audits = links.length
      ? await db.commercialAuditLog.findMany({
          where: { entityType: "CustomerCorporateLink", entityId: { in: links.map((row) => row.id) } },
          orderBy: { performedAt: "desc" },
          take: 30,
        })
      : [];
    const report = {
      database: host(process.env.DATABASE_URL),
      customer,
      individual: decision.ownCustomerStatus,
      consolidated: decision.decision.customerStatus,
      reason: decision.decision.reason,
      allowed: decision.decision.allowed,
      pendingRelationReadIncomplete: decision.pendingRelationReadIncomplete,
      pending: decision.pendingCorporateRelations.map((row) => ({
        company: row.companyName,
        cnpj: row.cnpjLabel,
        relatedCustomerId: row.relatedCustomerId,
        evidence: row.evidenceTypeLabel,
        source: row.sourceLabel,
        reliability: row.reliabilityLabel,
        date: row.dateLabel,
      })),
      confirmed: decision.corporateRelations.map((row) => ({
        company: row.companyName ?? row.relatedCompany,
        cnpj: row.cnpjLabel,
        origin: row.origin,
        closable: row.closable === true,
        note: row.reviewNote ?? row.evidence,
      })),
      history: decision.corporateLinkHistory,
      links: links.map((row) => ({
        direction: row.customerId === customer.id ? "deste cliente →" : "→ este cliente",
        customerId: row.customerId,
        relatedCustomerId: row.relatedCustomerId,
        status: row.status,
        evidenceKind: row.evidenceKind,
        fingerprints: (row.evidenceFingerprint ?? "").split(",").filter(Boolean).length,
        actorUserId: row.actorUserId,
        closedAt: row.closedAt,
        updatedAt: row.updatedAt,
      })),
      audits: audits.map((row) => ({ at: row.performedAt, action: row.action, by: row.performedBy, entityId: row.entityId })),
    };
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`Banco: ${report.database} (somente leitura)`);
    console.log(`Cliente: ${customer.companyName} · ${customer.taxId} · ${customer.id}`);
    console.log(`Decisão individual: ${report.individual} · consolidada: ${report.consolidated} · motivo: ${report.reason ?? "—"} · permite prazo: ${report.allowed}`);
    if (report.pendingRelationReadIncomplete) console.log("ATENÇÃO: leitura de vínculos incompleta (Radar/QSA) — pendência sem item a validar.");
    console.log(`\nPendentes (${report.pending.length}):`);
    for (const row of report.pending) console.log(`  - ${row.company} · ${row.cnpj} · ${row.evidence} · ${row.source} · ${row.reliability} · ${row.date} · id ${row.relatedCustomerId}`);
    console.log(`\nConfirmadas (${report.confirmed.length}):`);
    for (const row of report.confirmed) console.log(`  - [${row.origin}] ${row.company} · ${row.cnpj}${row.closable ? " · encerrável" : ""} · ${row.note}`);
    console.log(`\nHistórico (${report.history.length}):`);
    for (const row of report.history) console.log(`  - ${row.statusLabel} · ${row.companyName} · ${row.cnpjLabel} · ${row.reviewNote}`);
    console.log(`\nCustomerCorporateLink (${report.links.length}):`);
    for (const row of report.links) console.log(`  - ${row.direction} ${row.status} · ${row.evidenceKind ?? "—"} · impressões ${row.fingerprints} · ator ${row.actorUserId ?? "—"} · ${row.updatedAt?.toISOString?.() ?? row.updatedAt}`);
    console.log(`\nAuditoria CORPORATE_LINK_* (${report.audits.length}):`);
    for (const row of report.audits) console.log(`  - ${row.at.toISOString()} · ${row.action} · por ${row.by ?? "—"} · linha ${row.entityId}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
