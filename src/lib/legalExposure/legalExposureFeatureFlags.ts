/**
 * Fail closed. Sem env, ou com valor fora da lista, nenhuma chamada externa.
 * Permissão não liga a flag.
 */

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
  source: "DOMICILIO" | "DATAJUD" | "DJEN" | "ESCAVADOR";
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
  return filled(env, LEGAL_EXPOSURE_ENV.datajudBaseUrl) && filled(env, LEGAL_EXPOSURE_ENV.datajudApiKey);
}

export function djenConfigured(env: LegalExposureEnv = process.env): boolean {
  return filled(env, LEGAL_EXPOSURE_ENV.djenBaseUrl);
}

export function escavadorConfigured(env: LegalExposureEnv = process.env): boolean {
  return filled(env, LEGAL_EXPOSURE_ENV.escavadorApiKey);
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
  ];
}
