import { formatQuodPrice, readQuodDossierConfig } from "@/src/lib/quodDossier/config.js";
import { readIeptbOnlineConfig } from "@/src/lib/ieptbOnline/config.js";

export const CREDIT_INTELLIGENCE_PACKAGE_NAME = "Análise completa de risco e crédito";
export const CREDIT_INTELLIGENCE_PROVIDER = "Direct Data";

export type CreditIntelligencePackageConfig = {
  quod: ReturnType<typeof readQuodDossierConfig>;
  ieptb: ReturnType<typeof readIeptbOnlineConfig>;
};

export function readCreditIntelligencePackageConfig(
  env: NodeJS.ProcessEnv = process.env
): CreditIntelligencePackageConfig {
  return {
    quod: readQuodDossierConfig(env),
    ieptb: readIeptbOnlineConfig(env),
  };
}

export function formatPackagePrice(cents: number): string {
  return formatQuodPrice(cents);
}
