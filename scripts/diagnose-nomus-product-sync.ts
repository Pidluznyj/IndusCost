/**
 * Diagnóstico read-only: rastreia produto Nomus no sync (API + base local).
 *
 * Uso:
 *   tsx scripts/diagnose-nomus-product-sync.ts --code="520.22--"
 *   tsx scripts/diagnose-nomus-product-sync.ts --code="3.14.117.0014" --fetch-api
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { normalizeSku } from "../src/lib/nomusBomComparison.ts";
import {
  buildNomusProductFixture52022,
  findNomusProductRowsByCode,
  mapNomusProductsFromApiRows,
  nomusProductSecondaryCodeFromRow,
  nomusProductSkuFromRow,
} from "../src/lib/nomusProductsSyncMap.ts";

const prisma = new PrismaClient();

function parseCodeArg(): string {
  const arg = process.argv.find((a) => a.startsWith("--code="));
  if (arg) return arg.slice("--code=".length).trim();
  const idx = process.argv.indexOf("--code");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!.trim();
  return "520.22--";
}

function shouldFetchApi(): boolean {
  return process.argv.includes("--fetch-api");
}

function log(section: string, payload: unknown): void {
  console.warn(`\n=== ${section} ===`);
  console.warn(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
}

async function searchLocalDb(code: string) {
  const norm = normalizeSku(code);
  const loose = code.replace(/-+$/g, "");

  try {
    const catalog = await prisma.nomusProductCatalog.findMany({
    where: {
      OR: [
        { code: { equals: code, mode: "insensitive" } },
        { code: { equals: norm, mode: "insensitive" } },
        { code: { contains: loose, mode: "insensitive" } },
        { description: { contains: code, mode: "insensitive" } },
      ],
    },
    take: 20,
  });

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { sku: { equals: code, mode: "insensitive" } },
        { sku: { equals: norm, mode: "insensitive" } },
        { sku: { contains: loose, mode: "insensitive" } },
        { name: { contains: code, mode: "insensitive" } },
      ],
    },
    select: { id: true, sku: true, name: true, type: true, isNomusControlled: true },
    take: 20,
  });

  const materials = await prisma.material.findMany({
    where: {
      OR: [
        { code: { equals: code, mode: "insensitive" } },
        { code: { equals: norm, mode: "insensitive" } },
        { code: { contains: loose, mode: "insensitive" } },
        { description: { contains: code, mode: "insensitive" } },
      ],
    },
    select: { id: true, code: true, description: true, status: true },
    take: 20,
  });

  const bomStage = await prisma.nomusBomComponentStage.findMany({
    where: {
      OR: [
        { componentCode: { equals: code, mode: "insensitive" } },
        { componentCode: { equals: norm, mode: "insensitive" } },
        { parentCode: { equals: code, mode: "insensitive" } },
        { componentDescription: { contains: code, mode: "insensitive" } },
      ],
    },
    select: {
      componentCode: true,
      componentDescription: true,
      parentCode: true,
      isActiveDefault: true,
    },
    take: 20,
  });

  const secondaryCatalog = catalog.filter((row) => {
    const payload = row.rawPayload as Record<string, unknown> | null;
    if (!payload) return false;
    const secondary = nomusProductSecondaryCodeFromRow(payload);
    return secondary === code || (secondary && normalizeSku(secondary) === norm);
  });

  return { catalog, secondaryCatalog, products, materials, bomStage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      catalog: [],
      secondaryCatalog: [],
      products: [],
      materials: [],
      bomStage: [],
      dbError: message,
    };
  }
}

async function fetchApiProductsIfConfigured(): Promise<Record<string, unknown>[] | null> {
  const baseUrl = (process.env.NOMUS_BASE_URL ?? "").trim();
  if (!baseUrl) return null;

  const prevMax = process.env.NOMUS_PRODUCTS_MAX_PAGES;
  if (!prevMax) process.env.NOMUS_PRODUCTS_MAX_PAGES = "500";

  try {
    const mod = await import("./nomusProductsSyncV1.ts");
    if (typeof (mod as { fetchAllNomusProducts?: unknown }).fetchAllNomusProducts === "function") {
      return (mod as { fetchAllNomusProducts: (url: string) => Promise<Record<string, unknown>[]> }).fetchAllNomusProducts(baseUrl);
    }
  } catch {
    // fallback abaixo
  } finally {
    if (prevMax == null) delete process.env.NOMUS_PRODUCTS_MAX_PAGES;
    else process.env.NOMUS_PRODUCTS_MAX_PAGES = prevMax;
  }

  return null;
}

async function main(): Promise<void> {
  const code = parseCodeArg();
  const fetchApi = shouldFetchApi();

  log("Parâmetros", { code, fetchApi, normalized: normalizeSku(code) });

  const local = await searchLocalDb(code);
  if ("dbError" in local && local.dbError) {
    log("Base local", `Indisponível: ${local.dbError}`);
  }
  log("NomusProductCatalog", local.catalog);
  log("NomusProductCatalog (código secundário)", local.secondaryCatalog);
  log("Product", local.products);
  log("Material", local.materials);
  log("NomusBomComponentStage", local.bomStage);

  const fixture = buildNomusProductFixture52022();
  const fixtureMap = mapNomusProductsFromApiRows([fixture], new Set());
  log("Simulação fixture 520.22--", {
    eligible: fixtureMap.eligible,
    blocked: fixtureMap.blocked,
  });

  if (local.catalog.length > 0) {
    const row = local.catalog[0]!;
    const payload = (row.rawPayload ?? {}) as Record<string, unknown>;
    const mapped = mapNomusProductsFromApiRows([payload], new Set());
    log("Reclassificação do catálogo local", mapped);
  }

  if (fetchApi) {
    const apiRows = await fetchApiProductsIfConfigured();
    if (!apiRows) {
      log("API Nomus", "NOMUS_BASE_URL ausente ou fetch não disponível.");
    } else {
      const matches = findNomusProductRowsByCode(apiRows, code);
      log("API Nomus — totais", {
        totalFetched: apiRows.length,
        matches: matches.length,
      });
      if (matches.length > 0) {
        const mapped = mapNomusProductsFromApiRows(matches, new Set());
        log("API Nomus — payload bruto (1º match)", matches[0]);
        log("API Nomus — classificação", mapped);
      } else {
        log(
          "API Nomus",
          "Código não encontrado nas páginas buscadas — verificar paginação (NOMUS_PRODUCTS_MAX_PAGES) ou se o item não está em /produtos."
        );
      }
    }
  } else {
    log(
      "API Nomus",
      "Pulado. Use --fetch-api com NOMUS_BASE_URL configurado para consultar a origem."
    );
  }

  const recommendation =
    local.products.length > 0
      ? "Item já existe em Product."
      : local.materials.length > 0
        ? "Item existe como Material — verificar tela de materiais/estoque e resolução em BOM."
        : local.catalog.length > 0
          ? "Item no catálogo Nomus — executar npm run sync:nomus:products:apply após correção de classificação."
          : local.bomStage.length > 0
            ? "Item só no stage BOM — executar sync:nomus:master-data-apply-safe para Material."
            : "Item ausente localmente — rodar sync:nomus:products:apply e sync:nomus:bom-components:apply com --fetch-api neste diagnóstico.";

  log("Recomendação", recommendation);
}

main()
  .catch((err) => {
    console.error("[diagnose-nomus-product-sync] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
