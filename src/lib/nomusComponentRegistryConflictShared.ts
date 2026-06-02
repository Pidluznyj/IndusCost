import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";

/** Prefixo de código (ex.: 420.01 → 420.01A-, 420.01AX). */
export function componentCodeMatchesBasePrefix(codeBase: string, componentCode: string): boolean {
  const base = normalizeComponentCode(codeBase.replace(/%+$/g, ""));
  const code = normalizeComponentCode(componentCode);
  if (!base || !code) return false;
  if (code === base) return true;
  return code.startsWith(base);
}

export function expandCodeVariants(base: string): string[] {
  const core = base.trim().replace(/%+$/g, "");
  const variants = new Set<string>([core, normalizeSku(core)]);
  if (!core.endsWith("%")) {
    variants.add(`${core}%`);
    variants.add(`${normalizeSku(core)}%`);
  }
  return [...variants];
}

export function codeBaseLikeCore(codeBase: string): string {
  return codeBase.trim().replace(/%+$/g, "");
}

export function confirmationTextForRegistryCleanup(
  codeBase: string,
  scope: "ONE_PARENT" | "ALL_PARENTS",
  parentCode?: string | null
): string {
  const code = normalizeSku(codeBase.trim());
  if (scope === "ALL_PARENTS") {
    return `LIMPAR CADASTRO DIVERGENTE ${code} TODOS`;
  }
  const parent = normalizeSku(parentCode?.trim() ?? "");
  if (!parent) {
    throw new Error("parentCode é obrigatório para limpeza por produto pai.");
  }
  return `LIMPAR CADASTRO DIVERGENTE ${code} ${parent}`;
}
