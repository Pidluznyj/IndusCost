import { formatQuodPrice, quodBudgetMonthWindow, readQuodDossierConfig } from "@/src/lib/quodDossier/config.js";
import { readIeptbOnlineConfig } from "@/src/lib/ieptbOnline/config.js";

export const CREDIT_INTELLIGENCE_PACKAGE_NAME = "Análise completa de risco e crédito";
export const CREDIT_INTELLIGENCE_PROVIDER = "Direct Data";

export type CreditIntelligencePackageConfig = {
  quod: ReturnType<typeof readQuodDossierConfig>;
  ieptb: ReturnType<typeof readIeptbOnlineConfig>;
  /** 0 = sem teto global; valem só os limites por produto. Não sobe teto de produção. */
  monthlyLimitCents: number;
};

function positiveInt(value: string | undefined, fallback: number): number {
  if (value == null || String(value).trim() === "") return fallback;
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function readCreditIntelligencePackageConfig(
  env: NodeJS.ProcessEnv = process.env
): CreditIntelligencePackageConfig {
  return {
    quod: readQuodDossierConfig(env),
    ieptb: readIeptbOnlineConfig(env),
    monthlyLimitCents: positiveInt(env.CREDIT_INTELLIGENCE_MONTHLY_LIMIT_CENTS, 0),
  };
}

export function formatPackagePrice(cents: number): string {
  return formatQuodPrice(cents);
}

export { quodBudgetMonthWindow };
