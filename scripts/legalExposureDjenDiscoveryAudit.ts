/**
 * Auditoria somente leitura da descoberta DJEN por nome.
 *
 *   npm run legal-exposure:djen-discovery-audit
 *   npm run legal-exposure:djen-discovery-audit -- --live
 *
 * --live consulta o Comunica PJe por nome (sem persistir).
 * Sem --live, usa apenas o banco: processos físicos vs CNJs canônicos.
 */

import "dotenv/config";
import { buildDjenDiscoveryTerms } from "../src/lib/legalExposure/legalExposureDiscovery.js";
import { listCanonicalCases } from "../src/lib/legalExposure/legalExposureExecutive.js";
import { uniqueProcessNumbersFromBatch } from "../src/lib/legalExposure/legalExposurePipeline.js";
import { canonicalProcessKey, normalizeProcessNumber } from "../src/lib/legalExposure/legalExposureNormalization.js";
import { publicSourceConfiguration } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import type { LegalExposureMemory } from "../src/lib/legalExposure/legalExposureStore.js";

function wantsLive(): boolean {
  return process.argv.includes("--live");
}

function cnjOf(value: string | null | undefined, id?: string | null): string {
  return canonicalProcessKey(value, id).ok ? canonicalProcessKey(value, id).key : "";
}

function storedAudit(memory: LegalExposureMemory) {
  const byEntity = memory.entities.filter((row) => row.active).map((entity) => {
    const terms = buildDjenDiscoveryTerms({
      legalName: entity.legalName,
      tradeName: entity.tradeName,
      aliases: memory.aliases.filter((row) => row.entityId === entity.id),
    });
    const linked = new Set(memory.entityLinks.filter((row) => row.entityId === entity.id).map((row) => row.caseId));
    const cases = memory.cases.filter((row) => row.entityId === entity.id || linked.has(row.id));
    const cnjs = [...new Set(cases.map((row) => cnjOf(row.processNumberNormalized || row.processNumber, row.id)).filter(Boolean))];
    return {
      empresa: entity.legalName,
      termos: terms.map((row) => row.value),
      comunicacoes: memory.communications.filter((row) => cases.some((item) => item.id === row.caseId) || cnjs.includes(normalizeProcessNumber(row.processNumber) ?? "")).length,
      cnjsUnicos: cnjs,
    };
  });
  const items = listCanonicalCases(memory, {});
  const cnjToEntities = new Map<string, string[]>();
  for (const row of byEntity) {
    for (const cnj of row.cnjsUnicos) {
      const list = cnjToEntities.get(cnj) ?? [];
      list.push(row.empresa);
      cnjToEntities.set(cnj, list);
    }
  }
  return {
    empresas: byEntity,
    totalGrupo: {
      physicalCases: memory.cases.length,
      canonicalCnjs: items.length,
      visualDuplicates: items.length === new Set(items.map((row) => row.processNumber.replace(/\D/g, ""))).size ? false : true,
      cnjsEmMaisDeUmaEmpresa: [...cnjToEntities.entries()]
        .filter(([, names]) => new Set(names).size > 1)
        .map(([cnj, names]) => ({ cnj, empresas: [...new Set(names)] })),
    },
  };
}

async function main() {
  const configuration = publicSourceConfiguration();
  if (!process.env.DATABASE_URL) {
    console.log(JSON.stringify({ readOnly: true, persisted: false, aborted: "DATABASE_URL ausente.", configuration }, null, 2));
    return;
  }
  const { createPrismaExposureRepository } = await import("../src/lib/legalExposure/legalExposureRepository.server.js");
  const { prisma } = await import("../src/lib/prisma.js");
  let memory: LegalExposureMemory;
  try {
    memory = await createPrismaExposureRepository(prisma).load();
  } catch {
    await prisma.$disconnect().catch(() => undefined);
    console.log(JSON.stringify({ readOnly: true, persisted: false, aborted: "Banco local indisponível.", configuration }, null, 2));
    return;
  }

  const stored = storedAudit(memory);
  const live: Array<{ empresa: string; termos: string[]; paginas: number; comunicacoes: number; cnjsUnicos: string[]; truncated: boolean }> = [];

  if (wantsLive()) {
    const { searchDjen } = await import("../src/lib/legalExposure/sources/djen/djenClient.server.js");
    const { createDjenThrottle } = await import("../src/lib/legalExposure/sources/djen/djenThrottle.js");
    const throttle = createDjenThrottle({ intervalMs: 1500 });
    for (const entity of memory.entities.filter((row) => row.active)) {
      const terms = buildDjenDiscoveryTerms({
        legalName: entity.legalName,
        tradeName: entity.tradeName,
        aliases: memory.aliases.filter((row) => row.entityId === entity.id),
      });
      let pages = 0;
      let communications = 0;
      let truncated = false;
      const cnjs = new Set<string>();
      for (const term of terms) {
        const batch = await searchDjen({
          env: process.env,
          fetchImpl: fetch,
          throttle,
          query: { nomeParte: term.value },
        });
        pages += batch.pagination?.pagesFetched ?? 1;
        communications += batch.communications.length;
        truncated = truncated || Boolean(batch.pagination?.truncated);
        for (const cnj of uniqueProcessNumbersFromBatch(batch)) cnjs.add(cnj);
      }
      live.push({
        empresa: entity.legalName,
        termos: terms.map((row) => row.value),
        paginas: pages,
        comunicacoes: communications,
        cnjsUnicos: [...cnjs],
        truncated,
      });
    }
  }

  await prisma.$disconnect().catch(() => undefined);
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        persisted: false,
        live: wantsLive(),
        configuration: {
          djen: configuration.find((row) => row.source === "DJEN"),
          datajud: configuration.find((row) => row.source === "DATAJUD"),
          domicilio: configuration.find((row) => row.source === "DOMICILIO"),
          datajudCnpjDiscovery: process.env.DATAJUD_CNPJ_DISCOVERY_ENABLED ?? "0",
        },
        stored,
        liveDiscovery: live,
      },
      null,
      2
    )
  );
}

await main();
