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

const DATAJUD_SOURCE_FIELDS = [
  "numeroProcesso",
  "tribunal",
  "grau",
  "orgaoJulgador",
  "classe",
  "assuntos",
  "movimentos",
  "sistema",
  "formato",
  "nivelSigilo",
  "dataAjuizamento",
  "dataHoraUltimaAtualizacao",
  "prioridade",
  "valorCausa",
  "partes",
  "polos",
  "pessoas",
  "documentos",
  "arquivamento",
  "dataBaixa",
  "dataArquivamento",
  "situacao",
  "id",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstSource(body: unknown): Record<string, unknown> | null {
  const root = asRecord(body);
  const hitsWrap = asRecord(root?.hits);
  const hits = hitsWrap?.hits;
  if (!Array.isArray(hits) || hits.length === 0) return null;
  return asRecord(asRecord(hits[0])?._source);
}

/** Presença de campos no _source. Sem valores, sem PII. */
export function datajudFieldInventory(body: unknown): {
  hitCount: number;
  sourceKeys: string[];
  present: Record<string, boolean>;
  assuntosCount: number;
  movimentosCount: number;
  orgaoJulgadorKeys: string[];
  movimentoKeys: string[];
  assuntoKeys: string[];
  sistemaKeys: string[];
  classeKeys: string[];
} {
  const root = asRecord(body);
  const hitsWrap = asRecord(root?.hits);
  const hits = Array.isArray(hitsWrap?.hits) ? hitsWrap.hits : [];
  const source = firstSource(body);
  const sourceKeys = source ? Object.keys(source).sort() : [];
  const present = Object.fromEntries(
    DATAJUD_SOURCE_FIELDS.map((field) => [field, Boolean(source && field in source)])
  ) as Record<string, boolean>;
  const assuntos = Array.isArray(source?.assuntos) ? source.assuntos : [];
  const movimentos = Array.isArray(source?.movimentos) ? source.movimentos : [];
  return {
    hitCount: hits.length,
    sourceKeys,
    present,
    assuntosCount: assuntos.length,
    movimentosCount: movimentos.length,
    orgaoJulgadorKeys: Object.keys(asRecord(source?.orgaoJulgador) ?? {}).sort(),
    movimentoKeys: Object.keys(asRecord(movimentos[0]) ?? {}).sort(),
    assuntoKeys: Object.keys(asRecord(assuntos[0]) ?? {}).sort(),
    sistemaKeys: Object.keys(asRecord(source?.sistema) ?? {}).sort(),
    classeKeys: Object.keys(asRecord(source?.classe) ?? {}).sort(),
  };
}
