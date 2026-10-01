/**
 * Agenda oficial por fonte. UI e scheduler leem daqui.
 * Timezone: America/Sao_Paulo. Sem rotina ALL de hora em hora.
 */

import type { LegalExposureSource } from "./legalExposureContracts.js";
import {
  DATAJUD_PUBLIC_BASE_URL,
  DJEN_PUBLIC_BASE_URL,
  datajudConfigured,
  djenConfigured,
  domicilioConfigured,
  escavadorConfigured,
  isDatajudEnabled,
  isDjenEnabled,
  isDomicilioEnabled,
  isEscavadorEnabled,
  isJusbrasilEnabled,
  isLegalExposureModuleEnabled,
  jusbrasilConfigured,
  LEGAL_EXPOSURE_ENV,
  type LegalExposureEnv,
} from "./legalExposureFeatureFlags.js";

export const LEGAL_EXPOSURE_TIMEZONE = "America/Sao_Paulo";
export const LEGAL_EXPOSURE_HEALTH_INTERVAL_MINUTES = 15;
export const SOURCE_RUN_STALE_MS = 45 * 60 * 1000;

export type LegalExposureScheduledJob = {
  source: LegalExposureSource;
  job: string;
  times: string[];
  timezone: typeof LEGAL_EXPOSURE_TIMEZONE;
  enabled: boolean;
  description: string;
};

export const LEGAL_EXPOSURE_SOURCE_SCHEDULE: LegalExposureScheduledJob[] = [
  {
    source: "DJEN",
    job: "DISCOVERY",
    times: ["06:10", "12:10", "18:10", "23:10"],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: true,
    description: "Descoberta por nome da parte + atualização por CNJ",
  },
  {
    source: "DATAJUD",
    job: "ENRICH_KNOWN",
    times: ["06:40", "12:40", "18:40", "23:40"],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: true,
    description: "Enriquecimento dos CNJs conhecidos",
  },
  {
    source: "TRIBUNAL_PUBLIC",
    job: "PORTAL",
    times: ["07:20", "19:20"],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: true,
    description: "Portais públicos dos tribunais (sem CAPTCHA)",
  },
  {
    source: "ESCAVADOR",
    job: "COMPLEMENT_STALE",
    times: ["03:20"],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: true,
    description: "Complemento de processos incompletos ou stale",
  },
  {
    source: "JUSBRASIL",
    job: "COMPLEMENT_STALE",
    times: ["04:10"],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: true,
    description: "Complemento de processos incompletos ou stale",
  },
  {
    source: "TRT_CERTIFICATE",
    job: "MANUAL",
    times: [],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: false,
    description: "Certidões: fluxo manual/periódico, sem varredura diurna",
  },
  {
    source: "CNDT",
    job: "MANUAL",
    times: [],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: false,
    description: "Certidões: fluxo manual/periódico, sem varredura diurna",
  },
  {
    source: "DOMICILIO",
    job: "DISABLED_BY_POLICY",
    times: [],
    timezone: LEGAL_EXPOSURE_TIMEZONE,
    enabled: false,
    description: "Desligado por política até credencial válida e decisão explícita",
  },
];

export type SourceReadiness = "READY" | "NEEDS_CREDENTIAL" | "DISABLED_BY_POLICY" | "NOT_IMPLEMENTED" | "CONFIG_ERROR";

export type SourceReadinessState = {
  source: LegalExposureSource;
  readiness: SourceReadiness;
  configured: boolean;
  enabled: boolean;
  missingEnvVars: string[];
  hint: string;
};

function saoPauloWall(now: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LEGAL_EXPOSURE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((row) => row.type === type)?.value ?? 0);
  return { y: pick("year"), m: pick("month"), d: pick("day"), hh: pick("hour"), mm: pick("minute") };
}

function fromSaoPauloWall(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0));
}

function addSaoPauloDays(wall: ReturnType<typeof saoPauloWall>, days: number) {
  const utc = fromSaoPauloWall(wall.y, wall.m, wall.d, 12, 0);
  utc.setUTCDate(utc.getUTCDate() + days);
  return saoPauloWall(utc);
}

export function nextScheduledAt(times: string[], now: Date): string | null {
  if (times.length === 0) return null;
  const wall = saoPauloWall(now);
  const nowMinutes = wall.hh * 60 + wall.mm;
  const parsed = times
    .map((row) => {
      const [hh, mm] = row.split(":").map((part) => Number(part));
      return { hh, mm, minutes: hh * 60 + mm };
    })
    .filter((row) => Number.isFinite(row.minutes))
    .sort((a, b) => a.minutes - b.minutes);
  if (parsed.length === 0) return null;
  const today = parsed.find((row) => row.minutes > nowMinutes);
  if (today) return fromSaoPauloWall(wall.y, wall.m, wall.d, today.hh, today.mm).toISOString();
  const first = parsed[0]!;
  const tomorrow = addSaoPauloDays(wall, 1);
  return fromSaoPauloWall(tomorrow.y, tomorrow.m, tomorrow.d, first.hh, first.mm).toISOString();
}

export function scheduleForSource(source: LegalExposureSource): LegalExposureScheduledJob | null {
  return LEGAL_EXPOSURE_SOURCE_SCHEDULE.find((row) => row.source === source) ?? null;
}

export function sourceReadinessOf(
  source: LegalExposureSource,
  env: LegalExposureEnv = process.env
): SourceReadinessState {
  const moduleOn = isLegalExposureModuleEnabled(env);
  if (source === "DJEN") {
    const enabled = isDjenEnabled(env);
    return {
      source,
      readiness: enabled ? "READY" : moduleOn ? "READY" : "READY",
      configured: djenConfigured(env),
      enabled,
      missingEnvVars: [],
      hint: enabled
        ? `Endpoint público ${DJEN_PUBLIC_BASE_URL}`
        : `Configurado no endpoint público. Ligue ${LEGAL_EXPOSURE_ENV.djen} para executar.`,
    };
  }
  if (source === "DATAJUD") {
    const configured = datajudConfigured(env);
    const enabled = isDatajudEnabled(env);
    return {
      source,
      readiness: configured ? (enabled ? "READY" : "READY") : "NEEDS_CREDENTIAL",
      configured,
      enabled,
      missingEnvVars: configured ? [] : [LEGAL_EXPOSURE_ENV.datajudApiKey],
      hint: configured
        ? `Base ${DATAJUD_PUBLIC_BASE_URL}. ${enabled ? "Habilitado." : `Ligue ${LEGAL_EXPOSURE_ENV.datajud}.`}`
        : `Requer credencial DataJud (${LEGAL_EXPOSURE_ENV.datajudApiKey}).`,
    };
  }
  if (source === "ESCAVADOR") {
    const configured = escavadorConfigured(env);
    const enabled = isEscavadorEnabled(env);
    return {
      source,
      readiness: configured ? "READY" : "NEEDS_CREDENTIAL",
      configured,
      enabled,
      missingEnvVars: configured ? [] : [LEGAL_EXPOSURE_ENV.escavadorApiKey],
      hint: configured
        ? enabled
          ? "Habilitado."
          : `Credencial presente. Ligue ${LEGAL_EXPOSURE_ENV.escavador}.`
        : `Requer credencial Escavador (${LEGAL_EXPOSURE_ENV.escavadorApiKey}).`,
    };
  }
  if (source === "JUSBRASIL") {
    const configured = jusbrasilConfigured(env);
    const enabled = isJusbrasilEnabled(env);
    return {
      source,
      readiness: configured ? "READY" : "NEEDS_CREDENTIAL",
      configured,
      enabled,
      missingEnvVars: configured ? [] : [LEGAL_EXPOSURE_ENV.jusbrasilApiKey],
      hint: configured
        ? enabled
          ? "Habilitado."
          : `Credencial presente. Ligue ${LEGAL_EXPOSURE_ENV.jusbrasil}.`
        : `Requer credencial Jusbrasil (${LEGAL_EXPOSURE_ENV.jusbrasilApiKey}).`,
    };
  }
  if (source === "DOMICILIO") {
    const configured = domicilioConfigured(env);
    const enabled = isDomicilioEnabled(env);
    return {
      source,
      readiness: enabled && configured ? "READY" : "DISABLED_BY_POLICY",
      configured,
      enabled,
      missingEnvVars: configured
        ? []
        : [
            LEGAL_EXPOSURE_ENV.domicilioBaseUrl,
            LEGAL_EXPOSURE_ENV.domicilioTokenUrl,
            LEGAL_EXPOSURE_ENV.domicilioClientId,
            LEGAL_EXPOSURE_ENV.domicilioClientSecret,
            LEGAL_EXPOSURE_ENV.domicilioOnBehalfOf,
          ],
      hint: "Desligado por política. Nunca registra ciência automaticamente.",
    };
  }
  if (source === "TRIBUNAL_PUBLIC") {
    return {
      source,
      readiness: "READY",
      configured: true,
      enabled: moduleOn,
      missingEnvVars: [],
      hint: "Portais públicos conhecidos. Sem contorno de CAPTCHA.",
    };
  }
  if (source === "WEB_DISCOVERY") {
    return {
      source,
      readiness: "NOT_IMPLEMENTED",
      configured: false,
      enabled: false,
      missingEnvVars: [LEGAL_EXPOSURE_ENV.webDiscoveryApiKey, LEGAL_EXPOSURE_ENV.webDiscoveryBaseUrl],
      hint: "Localizador web complementar. Sem credencial, permanece desligado.",
    };
  }
  if (source === "TRT_CERTIFICATE" || source === "CNDT") {
    return {
      source,
      readiness: "READY",
      configured: true,
      enabled: false,
      missingEnvVars: [],
      hint: "Registro manual de certidões. Sem consulta automática repetida.",
    };
  }
  return {
    source,
    readiness: "CONFIG_ERROR",
    configured: false,
    enabled: false,
    missingEnvVars: [],
    hint: "Fonte sem classificação.",
  };
}

export function integrationTargetOf(source: LegalExposureSource | string): string {
  return `LEGAL_EXPOSURE_${String(source).toUpperCase()}`;
}
