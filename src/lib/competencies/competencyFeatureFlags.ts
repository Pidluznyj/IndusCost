/**
 * Ativação controlada de Competências e Desenvolvimento (Gestão de pessoas).
 *
 * Flag server-side por ambiente, no padrão do projeto (Fluxo de Pedidos, Exposure).
 * Fail closed: ausente, vazia ou valor desconhecido = DESLIGADA.
 *
 * Desligada:
 * - todas as rotas /api/hr/competencies/* respondem 404 (inclusive para SUPER_ADMIN);
 * - menu, rota e aba "Competências" da ficha somem (a UI consulta /feature-status).
 * Permissão não liga a flag; a flag não concede permissão.
 */
import type { RequestHandler } from "express";

export const COMPETENCIES_ENABLED_ENV = "COMPETENCIES_ENABLED";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

export function isCompetenciesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env[COMPETENCIES_ENABLED_ENV]?.trim().toLowerCase();
  return raw != null && ENABLED_VALUES.has(raw);
}

/** 404 quando desligada — não expõe um módulo não liberado. */
export function requireCompetenciesEnabled(isEnabled: () => boolean): RequestHandler {
  return (_req, res, next) => {
    if (!isEnabled()) {
      res.status(404).json({ error: "FEATURE_DISABLED", message: "Competências e Desenvolvimento não está ativado." });
      return;
    }
    next();
  };
}
