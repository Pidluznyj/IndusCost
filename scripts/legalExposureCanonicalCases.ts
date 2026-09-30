/**
 * Preview/apply de vínculos LegalCaseEntityLink a partir do legado LegalCase.entityId.
 * NÃO apaga duplicatas físicas. APPLY só no banco de homologação explícito.
 *
 *   npm run legal-exposure:canonical-cases -- preview
 *   npm run legal-exposure:canonical-preview
 *   npx tsx scripts/legalExposureCanonicalCases.ts --apply --confirm=LEGAL_EXPOSURE_CANONICAL
 */

import { randomUUID } from "node:crypto";
import {
  applyCanonicalEntityLinks,
  previewCanonicalGroups,
} from "../src/lib/legalExposure/legalExposureCanonical.js";

const APPLY_CONFIRM = "LEGAL_EXPOSURE_CANONICAL";
const HOMOLOG = { hosts: new Set(["127.0.0.1", "localhost"]), database: "teste_bi_homolog" };

const args = process.argv.slice(2);
const wantApply = args.includes("--apply");
const wantPreview = args.includes("--preview") || args.includes("preview") || !wantApply;
const confirm = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) ?? "";

function sanitisedTarget(raw: string | undefined): { host: string; port: string; database: string } | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, "").split("?")[0] ?? "",
    };
  } catch {
    return null;
  }
}

function assertHomologDatabase(raw: string): { host: string; port: string; database: string } {
  const target = sanitisedTarget(raw);
  if (!target) throw new Error("ABORTADO: DATABASE_URL ausente ou inválida.");
  const ok = HOMOLOG.hosts.has(target.host) && target.database === HOMOLOG.database;
  if (!ok) {
    throw new Error(
      `ABORTADO: apply só em homologação (${[...HOMOLOG.hosts].join("|")}/${HOMOLOG.database}). alvo=${target.host}:${target.port}/${target.database}`
    );
  }
  return target;
}

function printReport(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function loadMemory() {
  const { createPrismaExposureRepository } = await import("../src/lib/legalExposure/legalExposureRepository.server.js");
  const { prisma } = await import("../src/lib/prisma.js");
  const repository = createPrismaExposureRepository(prisma);
  const memory = await repository.load();
  return { prisma, memory };
}

async function diagnose(prisma: Awaited<ReturnType<typeof loadMemory>>["prisma"]) {
  const [
    physicalCases,
    uniqueCnj,
    entityLinks,
    multiCompany,
    casesWithoutLink,
    casesWithoutEvidence,
    casesWithoutMovement,
  ] = await Promise.all([
    prisma.legalCase.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT "processNumberNormalized")::bigint AS count FROM "LegalCase"`,
    prisma.legalCaseEntityLink.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT "processNumberNormalized"
        FROM "LegalCase"
        GROUP BY "processNumberNormalized"
        HAVING COUNT(DISTINCT "entityId") > 1
      ) grouped
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "LegalCase" c
      LEFT JOIN "LegalCaseEntityLink" l ON l."caseId" = c.id
      WHERE l.id IS NULL
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "LegalCase" c
      WHERE NOT EXISTS (SELECT 1 FROM "LegalCaseSourceEvidence" e WHERE e."caseId" = c.id)
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "LegalCase" c
      WHERE NOT EXISTS (SELECT 1 FROM "LegalCaseMovement" m WHERE m."caseId" = c.id)
    `,
  ]);
  return {
    physicalCases,
    uniqueCnj: Number(uniqueCnj[0]?.count ?? 0),
    entityLinks,
    cnjWithMoreThanOneCompany: Number(multiCompany[0]?.count ?? 0),
    casesWithoutLink: Number(casesWithoutLink[0]?.count ?? 0),
    casesWithoutEvidence: Number(casesWithoutEvidence[0]?.count ?? 0),
    casesWithoutMovement: Number(casesWithoutMovement[0]?.count ?? 0),
  };
}

async function main(): Promise<void> {
  const target = sanitisedTarget(process.env.DATABASE_URL);
  if (wantApply) {
    if (confirm !== APPLY_CONFIRM) {
      printReport({ executed: false, reason: `APPLY exige --confirm=${APPLY_CONFIRM}` });
      process.exit(2);
    }
    const homolog = assertHomologDatabase(process.env.DATABASE_URL ?? "");
    const { prisma, memory } = await loadMemory();
    const before = previewCanonicalGroups(memory);
    const result = applyCanonicalEntityLinks(memory, () => randomUUID());
    if (result.created > 0) {
      await prisma.legalCaseEntityLink.createMany({
        data: memory.entityLinks.slice(-result.created).map((row) => ({
          id: row.id,
          caseId: row.caseId,
          entityId: row.entityId,
          pole: row.pole,
          confidence: row.confidence,
          firstSource: row.firstSource,
          lastSource: row.lastSource,
          firstSeenAt: new Date(row.firstSeenAt),
          lastSeenAt: new Date(row.lastSeenAt),
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        })),
        skipDuplicates: true,
      });
    }
    const afterMemory = await (await import("../src/lib/legalExposure/legalExposureRepository.server.js"))
      .createPrismaExposureRepository(prisma)
      .load();
    const after = previewCanonicalGroups(afterMemory);
    printReport({
      mode: "apply",
      target: `${homolog.host}:${homolog.port}/${homolog.database}`,
      created: result.created,
      skipped: result.skipped,
      before: {
        entityLinksExisting: before.entityLinksExisting,
        entityLinksToCreate: before.entityLinksToCreate,
      },
      after: {
        entityLinksExisting: after.entityLinksExisting,
        entityLinksToCreate: after.entityLinksToCreate,
      },
      diagnose: await diagnose(prisma),
    });
    await prisma.$disconnect();
    return;
  }

  if (!wantPreview) return;
  try {
    const { prisma, memory } = await loadMemory();
    const report = previewCanonicalGroups(memory);
    printReport({
      mode: "preview",
      target: target ? `${target.host}:${target.port}/${target.database}` : "unset",
      note: "Preview não escreve. Duplicatas físicas não são apagadas. Apply exige homologação + --confirm=LEGAL_EXPOSURE_CANONICAL.",
      physicalCases: report.physicalCases,
      uniqueCnj: report.uniqueCnj,
      duplicateCnjGroups: report.duplicateCnjGroups,
      entityLinksExisting: report.entityLinksExisting,
      entityLinksToCreate: report.entityLinksToCreate,
      casesWithoutEntity: report.casesWithoutEntity,
      casesWithoutNormalizedNumber: report.casesWithoutNormalizedNumber,
      movements: report.movements,
      evidences: report.evidences,
      communications: report.communications,
      duplicatedProcesses: report.duplicatedProcesses,
      diagnose: await diagnose(prisma),
    });
    await prisma.$disconnect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const compact = message.split("\n").filter((line) => line.includes("Can't reach") || line.includes("ABORTADO") || line.startsWith("Invalid")).slice(0, 3).join(" | ") || message.slice(0, 240);
    printReport({
      mode: "preview",
      target: target ? `${target.host}:${target.port}/${target.database}` : "unset",
      loaded: false,
      physicalCases: 0,
      uniqueCnj: 0,
      duplicateCnjGroups: 0,
      entityLinksExisting: 0,
      entityLinksToCreate: 0,
      casesWithoutEntity: 0,
      casesWithoutNormalizedNumber: 0,
      movements: 0,
      evidences: 0,
      communications: 0,
      duplicatedProcesses: [],
      error: compact,
    });
    process.exitCode = 0;
  }
}

void main();
