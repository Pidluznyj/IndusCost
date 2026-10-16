/**
 * Desempenho, Cultura e Potencial. Tudo desligado por padrão.
 * A flag do módulo não homologa metodologia nem liga lembrete ou OTP.
 */
import type { RequestHandler } from "express";

const ENABLED = new Set(["1", "true", "yes", "on", "enabled"]);

export const PERFORMANCE_CYCLE_ENABLED_ENV = "PERFORMANCE_CYCLE_ENABLED";
export const PERFORMANCE_OFFICIAL_PUBLICATION_ENV = "PERFORMANCE_OFFICIAL_PUBLICATION";
export const PERFORMANCE_IDENTITY_OTP_ENV = "PERFORMANCE_IDENTITY_OTP";
export const PERFORMANCE_REMINDERS_ENV = "PERFORMANCE_REMINDERS_ENABLED";

function on(env: Record<string, string | undefined>, key: string): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return raw != null && ENABLED.has(raw);
}

export function isPerformanceCycleEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return on(env, PERFORMANCE_CYCLE_ENABLED_ENV);
}

export function isOfficialPublicationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return on(env, PERFORMANCE_OFFICIAL_PUBLICATION_ENV);
}

export function isIdentityOtpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return on(env, PERFORMANCE_IDENTITY_OTP_ENV);
}

export function isPerformanceRemindersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return on(env, PERFORMANCE_REMINDERS_ENV);
}

export function requirePerformanceCycleEnabled(isEnabled: () => boolean): RequestHandler {
  return (_req, res, next) => {
    if (!isEnabled()) {
      res.status(404).json({ error: "FEATURE_DISABLED", message: "Desempenho e Cultura não está ativado." });
      return;
    }
    next();
  };
}
