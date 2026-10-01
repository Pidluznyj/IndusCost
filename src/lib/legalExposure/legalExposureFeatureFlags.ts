/**
 * Fail closed. Sem env, ou com valor fora da lista, nenhuma chamada externa.
 * Permissão não liga a flag.
 */

export const DJEN_PUBLIC_BASE_URL = "https://comunicaapi.pje.jus.br";
export const DATAJUD_PUBLIC_BASE_URL = "https://api-publica.datajud.cnj.jus.br";

export const LEGAL_EXPOSURE_ENV = {
  module: "LEGAL_EXPOSURE_ENABLED",
  domicilio: "PDPJ_DOMICILIO_ENABLED",
  domicilioBaseUrl: "PDPJ_DOMICILIO_BASE_URL",
  domicilioTokenUrl: "PDPJ_DOMICILIO_TOKEN_URL",
  domicilioClientId: "PDPJ_DOMICILIO_CLIENT_ID",
  domicilioClientSecret: "PDPJ_DOMICILIO_CLIENT_SECRET",
  domicilioOnBehalfOf: "PDPJ_DOMICILIO_ON_BEHALF_OF_CPF",
  domicilioIdentityPath: "PDPJ_DOMICILIO_IDENTITY_PATH",
  domicilioCommunicationsPath: "PDPJ_DOMICILIO_COMMUNICATIONS_PATH",
  datajud: "DATAJUD_ENABLED",
  datajudCnpjDiscovery: "DATAJUD_CNPJ_DISCOVERY_ENABLED",
  datajudBaseUrl: "DATAJUD_BASE_URL",
  datajudApiKey: "DATAJUD_API_KEY",
  datajudMinRequestIntervalMs: "DATAJUD_MIN_REQUEST_INTERVAL_MS",
  djen: "DJEN_ENABLED",
  djenBaseUrl: "DJEN_BASE_URL",
  djenMaxPages: "DJEN_MAX_PAGES",
  djenMinRequestIntervalMs: "DJEN_MIN_REQUEST_INTERVAL_MS",
  autosync: "LEGAL_EXPOSURE_AUTOSYNC_ENABLED",
  escavador: "ESCAVADOR_ENABLED",
  escavadorBaseUrl: "ESCAVADOR_BASE_URL",
  escavadorApiKey: "ESCAVADOR_API_KEY",
  escavadorMinRequestIntervalMs: "ESCAVADOR_MIN_REQUEST_INTERVAL_MS",
  escavadorTimeoutMs: "ESCAVADOR_TIMEOUT_MS",
  escavadorRefreshHours: "ESCAVADOR_REFRESH_HOURS",
  jusbrasil: "JUSBRASIL_ENABLED",
  jusbrasilBaseUrl: "JUSBRASIL_BASE_URL",
  jusbrasilApiKey: "JUSBRASIL_API_KEY",
  jusbrasilTimeoutMs: "JUSBRASIL_TIMEOUT_MS",
  jusbrasilMinRequestIntervalMs: "JUSBRASIL_MIN_REQUEST_INTERVAL_MS",
  webDiscovery: "WEB_DISCOVERY_ENABLED",
  webDiscoveryBaseUrl: "WEB_DISCOVERY_BASE_URL",
  webDiscoveryApiKey: "WEB_DISCOVERY_API_KEY",
} as const;

const ENABLED = new Set(["1", "true", "yes", "on", "enabled"]);

export type LegalExposureEnv = Record<string, string | undefined>;

export function isEnvFlagOn(name: string, env: LegalExposureEnv = process.env): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw != null && ENABLED.has(raw);
}

export function isLegalExposureModuleEnabled(env: LegalExposureEnv = process.env): boolean {
  return isEnvFlagOn(LEGAL_EXPOSURE_ENV.module, env);
}

export function isDomicilioEnabled(env: LegalExposureEnv = process.env): boolean {
  return isLegalExposureModuleEnabled(env) && isEnvFlagOn(LEGAL_EXPOSURE_ENV.domicilio, env);
}

export function isDatajudEnabled(env: LegalExposureEnv = process.env): boolean {
  return isLegalExposureModuleEnabled(env) && isEnvFlagOn(LEGAL_EXPOSURE_ENV.datajud, env);
}

export function isDatajudCnpjDiscoveryEnabled(env: LegalExposureEnv = process.env): boolean {
  return isDatajudEnabled(env) && isEnvFlagOn(LEGAL_EXPOSURE_ENV.datajudCnpjDiscovery, env);
}

export function isDjenEnabled(env: LegalExposureEnv = process.env): boolean {
  return isLegalExposureModuleEnabled(env) && isEnvFlagOn(LEGAL_EXPOSURE_ENV.djen, env);
}

export function isLegalExposureAutosyncEnabled(env: LegalExposureEnv = process.env): boolean {
  return isEnvFlagOn(LEGAL_EXPOSURE_ENV.autosync, env);
}

export function isEscavadorEnabled(env: LegalExposureEnv = process.env): boolean {
  return isLegalExposureModuleEnabled(env) && isEnvFlagOn(LEGAL_EXPOSURE_ENV.escavador, env);
}

export function isJusbrasilEnabled(env: LegalExposureEnv = process.env): boolean {
  return isLegalExposureModuleEnabled(env) && isEnvFlagOn(LEGAL_EXPOSURE_ENV.jusbrasil, env);
}

export function isWebDiscoveryEnabled(env: LegalExposureEnv = process.env): boolean {
  return isLegalExposureModuleEnabled(env) && isEnvFlagOn(LEGAL_EXPOSURE_ENV.webDiscovery, env);
}

export function clampEscavadorMinRequestIntervalMs(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? "1500"), 10);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.min(10_000, Math.max(500, parsed));
}

export function escavadorRefreshHours(env: LegalExposureEnv = process.env): number {
  const parsed = Number.parseInt(String(env[LEGAL_EXPOSURE_ENV.escavadorRefreshHours] ?? "24"), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 24;
  return Math.min(168, parsed);
}

export type SourceConfigurationState = {
  source: "DOMICILIO" | "DATAJUD" | "DJEN" | "ESCAVADOR" | "JUSBRASIL" | "TRIBUNAL_PUBLIC" | "WEB_DISCOVERY";
  enabled: boolean;
  configured: boolean;
};

function filled(env: LegalExposureEnv, name: string): boolean {
  return Boolean(env[name]?.trim());
}

export function domicilioConfigured(env: LegalExposureEnv = process.env): boolean {
  return (
    filled(env, LEGAL_EXPOSURE_ENV.domicilioBaseUrl) &&
    filled(env, LEGAL_EXPOSURE_ENV.domicilioTokenUrl) &&
    filled(env, LEGAL_EXPOSURE_ENV.domicilioClientId) &&
    filled(env, LEGAL_EXPOSURE_ENV.domicilioClientSecret) &&
    filled(env, LEGAL_EXPOSURE_ENV.domicilioOnBehalfOf) &&
    filled(env, LEGAL_EXPOSURE_ENV.domicilioIdentityPath) &&
    filled(env, LEGAL_EXPOSURE_ENV.domicilioCommunicationsPath)
  );
}

export function datajudConfigured(env: LegalExposureEnv = process.env): boolean {
  const base = env[LEGAL_EXPOSURE_ENV.datajudBaseUrl]?.trim() || DATAJUD_PUBLIC_BASE_URL;
  return Boolean(base) && filled(env, LEGAL_EXPOSURE_ENV.datajudApiKey);
}

export function datajudBaseUrl(env: LegalExposureEnv = process.env): string {
  return (env[LEGAL_EXPOSURE_ENV.datajudBaseUrl]?.trim() || DATAJUD_PUBLIC_BASE_URL).replace(/\/$/, "");
}

export function djenConfigured(_env: LegalExposureEnv = process.env): boolean {
  return true;
}

export function djenBaseUrl(env: LegalExposureEnv = process.env): string {
  return (env[LEGAL_EXPOSURE_ENV.djenBaseUrl]?.trim() || DJEN_PUBLIC_BASE_URL).replace(/\/$/, "");
}

export function escavadorConfigured(env: LegalExposureEnv = process.env): boolean {
  return filled(env, LEGAL_EXPOSURE_ENV.escavadorApiKey);
}

export function jusbrasilConfigured(env: LegalExposureEnv = process.env): boolean {
  return filled(env, LEGAL_EXPOSURE_ENV.jusbrasilApiKey);
}

export function webDiscoveryConfigured(env: LegalExposureEnv = process.env): boolean {
  return filled(env, LEGAL_EXPOSURE_ENV.webDiscoveryApiKey) && filled(env, LEGAL_EXPOSURE_ENV.webDiscoveryBaseUrl);
}

export function clampJusbrasilMinRequestIntervalMs(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? "1500"), 10);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.min(10_000, Math.max(500, parsed));
}

/** Presença, nunca o valor. */
export function publicSourceConfiguration(env: LegalExposureEnv = process.env): SourceConfigurationState[] {
  return [
    {
      source: "DOMICILIO",
      enabled: isDomicilioEnabled(env),
      configured: domicilioConfigured(env),
    },
    {
      source: "DATAJUD",
      enabled: isDatajudEnabled(env),
      configured: datajudConfigured(env),
    },
    {
      source: "DJEN",
      enabled: isDjenEnabled(env),
      configured: djenConfigured(env),
    },
    {
      source: "ESCAVADOR",
      enabled: isEscavadorEnabled(env),
      configured: escavadorConfigured(env),
    },
    {
      source: "JUSBRASIL",
      enabled: isJusbrasilEnabled(env),
      configured: jusbrasilConfigured(env),
    },
    {
      source: "TRIBUNAL_PUBLIC",
      enabled: isLegalExposureModuleEnabled(env),
      configured: true,
    },
    {
      source: "WEB_DISCOVERY",
      enabled: isWebDiscoveryEnabled(env),
      configured: webDiscoveryConfigured(env),
    },
  ];
}
