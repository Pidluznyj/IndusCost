/**
 * Contas institucionais do Domicílio: uma por CNPJ, cada uma com credencial,
 * CPF On-behalf-Of e tenant próprios. Nenhuma conta enxerga a outra.
 *
 * As chaves vêm de PDPJ_DOMICILIO_ACCOUNTS (ex.: "LAZARIOS,KOPPETEL") e cada chave
 * lê PDPJ_DOMICILIO_<CHAVE>_*. Não há conta padrão: sem CNPJ a credencial não é usada.
 */

import type { LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { normalizeExposureCnpj } from "../../legalExposureNormalization.js";
import { DOMICILIO_ALLOWED_HOST_SUFFIXES } from "./domicilioContracts.js";

export const DOMICILIO_ENV = {
  accounts: "PDPJ_DOMICILIO_ACCOUNTS",
  baseUrl: "PDPJ_DOMICILIO_BASE_URL",
  tokenUrl: "PDPJ_DOMICILIO_TOKEN_URL",
  maxConcurrency: "PDPJ_DOMICILIO_MAX_CONCURRENCY",
  backfillDays: "PDPJ_DOMICILIO_BACKFILL_DAYS",
  minRequestIntervalMs: "PDPJ_DOMICILIO_MIN_REQUEST_INTERVAL_MS",
  maxPages: "PDPJ_DOMICILIO_MAX_PAGES",
  overlapDays: "PDPJ_DOMICILIO_OVERLAP_DAYS",
  reconcileMaxProcesses: "PDPJ_DOMICILIO_RECONCILE_MAX_PROCESSES",
} as const;

const ACCOUNT_FIELDS = {
  cnpj: "CNPJ",
  clientId: "CLIENT_ID",
  clientSecret: "CLIENT_SECRET",
  onBehalfOf: "ON_BEHALF_OF_CPF",
  tenantId: "TENANT_ID",
} as const;

export type DomicilioAccount = {
  /** Chave operacional (ex.: LAZARIOS). Aparece em log e auditoria; não é segredo. */
  key: string;
  cnpj: string;
  clientId: string;
  clientSecret: string;
  onBehalfOf: string;
  /** Opcional. Quando informado, tem de bater com o perfil devolvido pelo CNJ. */
  tenantId: string | null;
};

export type DomicilioAccountProblem = { key: string; missing: string[] };

export function domicilioAccountEnvName(key: string, field: keyof typeof ACCOUNT_FIELDS): string {
  return `PDPJ_DOMICILIO_${key}_${ACCOUNT_FIELDS[field]}`;
}

function read(env: LegalExposureEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function domicilioAccountKeys(env: LegalExposureEnv): string[] {
  const keys = read(env, DOMICILIO_ENV.accounts)
    .split(",")
    .map((key) => key.trim().toUpperCase())
    .filter((key) => /^[A-Z][A-Z0-9_]{0,31}$/.test(key));
  return [...new Set(keys)];
}

/** Contas completas e, à parte, as incompletas com o nome das variáveis que faltam. */
export function loadDomicilioAccounts(env: LegalExposureEnv): {
  accounts: DomicilioAccount[];
  problems: DomicilioAccountProblem[];
} {
  const accounts: DomicilioAccount[] = [];
  const problems: DomicilioAccountProblem[] = [];
  const seenCnpj = new Set<string>();
  for (const key of domicilioAccountKeys(env)) {
    const cnpj = normalizeExposureCnpj(read(env, domicilioAccountEnvName(key, "cnpj")));
    const clientId = read(env, domicilioAccountEnvName(key, "clientId"));
    const clientSecret = read(env, domicilioAccountEnvName(key, "clientSecret"));
    const onBehalfOf = read(env, domicilioAccountEnvName(key, "onBehalfOf")).replace(/\D/g, "");
    const missing = [
      cnpj ? null : domicilioAccountEnvName(key, "cnpj"),
      clientId ? null : domicilioAccountEnvName(key, "clientId"),
      clientSecret ? null : domicilioAccountEnvName(key, "clientSecret"),
      onBehalfOf.length === 11 ? null : domicilioAccountEnvName(key, "onBehalfOf"),
    ].filter((name): name is string => name != null);
    // Dois blocos com o mesmo CNPJ seriam duas credenciais para a mesma empresa: recusa o segundo.
    if (cnpj && seenCnpj.has(cnpj)) missing.push(`${domicilioAccountEnvName(key, "cnpj")} (duplicado)`);
    if (missing.length > 0 || !cnpj) {
      problems.push({ key, missing });
      continue;
    }
    seenCnpj.add(cnpj);
    accounts.push({
      key,
      cnpj,
      clientId,
      clientSecret,
      onBehalfOf,
      tenantId: read(env, domicilioAccountEnvName(key, "tenantId")) || null,
    });
  }
  return { accounts, problems };
}

export function findDomicilioAccountByCnpj(env: LegalExposureEnv, cnpj: string): DomicilioAccount | null {
  const normalized = normalizeExposureCnpj(cnpj);
  if (!normalized) return null;
  return loadDomicilioAccounts(env).accounts.find((account) => account.cnpj === normalized) ?? null;
}

/** HTTPS em domínio oficial. Qualquer outra URL é recusada (SSRF). */
export function isAllowedDomicilioUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return DOMICILIO_ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type DomicilioEndpoints = { baseUrl: string; tokenUrl: string };

export function domicilioEndpoints(env: LegalExposureEnv): DomicilioEndpoints | null {
  const baseUrl = read(env, DOMICILIO_ENV.baseUrl).replace(/\/+$/, "");
  const tokenUrl = read(env, DOMICILIO_ENV.tokenUrl);
  if (!baseUrl || !tokenUrl) return null;
  if (!isAllowedDomicilioUrl(baseUrl) || !isAllowedDomicilioUrl(tokenUrl)) return null;
  return { baseUrl, tokenUrl };
}

export function domicilioMaxConcurrency(env: LegalExposureEnv): number {
  return clampInt(read(env, DOMICILIO_ENV.maxConcurrency), 2, 1, 4);
}

export function domicilioBackfillDays(env: LegalExposureEnv): number {
  return clampInt(read(env, DOMICILIO_ENV.backfillDays), 30, 1, 365);
}

export function domicilioMinRequestIntervalMs(env: LegalExposureEnv): number {
  return clampInt(read(env, DOMICILIO_ENV.minRequestIntervalMs), 500, 100, 10_000);
}

/** Dias relidos antes do checkpoint a cada execução (padrão 2). Sujeito à homologação. */
export function domicilioOverlapDays(env: LegalExposureEnv): number {
  return clampInt(read(env, DOMICILIO_ENV.overlapDays), 2, 0, 30);
}

/** Processos com comunicação pendente relidos por execução (padrão 25). Sujeito à homologação. */
export function domicilioReconcileMaxProcesses(env: LegalExposureEnv): number {
  return clampInt(read(env, DOMICILIO_ENV.reconcileMaxProcesses), 25, 0, 200);
}

export function domicilioMaxPages(env: LegalExposureEnv): number {
  return clampInt(read(env, DOMICILIO_ENV.maxPages), 100, 1, 1000);
}

/** Presença das contas, nunca o valor: chave, CNPJ e o que falta configurar. */
export function publicDomicilioAccounts(env: LegalExposureEnv): Array<{
  key: string;
  cnpj: string | null;
  configured: boolean;
  missingEnvVars: string[];
}> {
  const { accounts, problems } = loadDomicilioAccounts(env);
  return [
    ...accounts.map((account) => ({ key: account.key, cnpj: account.cnpj, configured: true, missingEnvVars: [] })),
    ...problems.map((problem) => ({
      key: problem.key,
      cnpj: normalizeExposureCnpj(read(env, domicilioAccountEnvName(problem.key, "cnpj"))),
      configured: false,
      missingEnvVars: problem.missing,
    })),
  ];
}
