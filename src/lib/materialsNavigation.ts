/**
 * Rotas e seções do módulo Suprimentos (materials).
 */

export const MATERIALS_BASE_PATH = "/materials" as const;

export const MATERIALS_SECTION_IDS = ["catalog", "marketIntelligence"] as const;

export type MaterialsSectionId = (typeof MATERIALS_SECTION_IDS)[number];

export const MATERIALS_SECTION_PATHS: Record<MaterialsSectionId, string> = {
  catalog: MATERIALS_BASE_PATH,
  marketIntelligence: `${MATERIALS_BASE_PATH}/market-intelligence`,
};

export const MATERIALS_MARKET_INTELLIGENCE_MONITORED_API =
  "/api/materials/market-intelligence/monitored" as const;

export function getMaterialMarketIntelligenceDetailPath(materialId: string): string {
  return `${MATERIALS_SECTION_PATHS.marketIntelligence}/${materialId}`;
}

export const MATERIALS_DEFAULT_SECTION: MaterialsSectionId = "catalog";

export type MaterialsSectionDef = {
  id: MaterialsSectionId;
  label: string;
  path: string;
  description: string;
};

export const MATERIALS_SECTIONS: MaterialsSectionDef[] = [
  {
    id: "catalog",
    label: "Matérias-primas",
    path: MATERIALS_SECTION_PATHS.catalog,
    description: "Cadastro e gestão de matérias-primas, insumos e custos de aquisição.",
  },
  {
    id: "marketIntelligence",
    label: "Inteligência de Mercado",
    path: MATERIALS_SECTION_PATHS.marketIntelligence,
    description: "Monitoramento de matérias-primas e sinais de mercado para decisões de compra.",
  },
];

export function getMaterialsDefaultPath(): string {
  return MATERIALS_SECTION_PATHS[MATERIALS_DEFAULT_SECTION];
}

export function parseMaterialsSectionFromPath(pathname: string): MaterialsSectionId | null {
  if (pathname.includes("/materials/market-intelligence")) return "marketIntelligence";
  if (pathname === MATERIALS_BASE_PATH || pathname.startsWith(`${MATERIALS_BASE_PATH}/`)) {
    return "catalog";
  }
  return null;
}

export function isMaterialMarketIntelligenceDetailPath(pathname: string): boolean {
  return /^\/materials\/market-intelligence\/[^/]+$/.test(pathname);
}

export function parseMaterialIdFromMarketIntelligencePath(pathname: string): string | null {
  const match = pathname.match(/^\/materials\/market-intelligence\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function isMaterialsCanonicalPath(pathname: string): boolean {
  if (pathname === MATERIALS_BASE_PATH) return true;
  if (pathname === MATERIALS_SECTION_PATHS.marketIntelligence) return true;
  if (isMaterialMarketIntelligenceDetailPath(pathname)) return true;
  return false;
}

export function resolveMaterialsCanonicalPath(pathname: string): string {
  const section = parseMaterialsSectionFromPath(pathname);
  if (section === "marketIntelligence") return MATERIALS_SECTION_PATHS.marketIntelligence;
  return getMaterialsDefaultPath();
}
