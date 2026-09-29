/**
 * Probe de schema: só roda com confirmação explícita do operador.
 * Este módulo não executa rede por conta própria.
 */

import { datajudProbeConfirmation } from "./datajudContracts.js";

export function datajudProbePlan(argv: readonly string[]): {
  execute: boolean;
  reason: string;
} {
  const confirmation = datajudProbeConfirmation(argv);
  if (confirmation.ok === false) return { execute: false, reason: confirmation.reason };
  return { execute: true, reason: "confirmado pelo operador" };
}

/** Extrai apenas caminhos de chaves, nunca valores. */
export function datajudSchemaPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 4 || !value || typeof value !== "object") return prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    const first = value[0];
    return datajudSchemaPaths(first, `${prefix}[]`, depth + 1);
  }
  const paths: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = prefix ? `${prefix}.${key}` : key;
    const nested = datajudSchemaPaths((value as Record<string, unknown>)[key], next, depth + 1);
    paths.push(...(nested.length ? nested : [next]));
  }
  return paths;
}
