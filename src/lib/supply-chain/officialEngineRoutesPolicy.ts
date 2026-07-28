/**
 * Política de rotas: SC não deve mutar APIs dos motores oficiais.
 */

import { OFFICIAL_ENGINE_MUTATION_FORBIDDEN_API_PREFIXES } from "./officialEngineBoundary.js";

const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isOfficialEngineMutationForbiddenApiPath(path: string): boolean {
  const normalized = path.split("?")[0]?.trim() ?? "";
  return OFFICIAL_ENGINE_MUTATION_FORBIDDEN_API_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix)
  );
}

export function isOfficialEngineHttpMutationForbidden(
  method: string,
  path: string
): boolean {
  const m = method.trim().toUpperCase();
  if (!MUTATING_HTTP_METHODS.has(m)) return false;
  return isOfficialEngineMutationForbiddenApiPath(path);
}

/**
 * Extrai pares method+path de chamadas fetch/fetchJsonOk em fontes SC.
 * Heurística estática — suficiente para barreira de regressão.
 */
export function extractHttpCallsFromSource(source: string): Array<{
  method: string;
  path: string;
}> {
  const calls: Array<{ method: string; path: string }> = [];

  // fetchJsonOk<T>("path") — default GET
  const fetchJsonOkRe =
    /fetchJsonOk\s*(?:<[^>]*>)?\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(fetchJsonOkRe)) {
    calls.push({ method: "GET", path: match[1]! });
  }

  // fetchJsonOk("path", { method: "POST" ...})
  const fetchJsonOkWithOptsRe =
    /fetchJsonOk\s*(?:<[^>]*>)?\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(fetchJsonOkWithOptsRe)) {
    const path = match[1]!;
    const opts = match[2] ?? "";
    const methodMatch = opts.match(/method\s*:\s*["'`](\w+)["'`]/i);
    calls.push({ method: methodMatch?.[1]?.toUpperCase() ?? "GET", path });
  }

  // fetch("/path", { method: "PUT" })
  const fetchRe =
    /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{([^}]*)\})?/g;
  for (const match of source.matchAll(fetchRe)) {
    const path = match[1]!;
    const opts = match[2] ?? "";
    const methodMatch = opts.match(/method\s*:\s*["'`](\w+)["'`]/i);
    calls.push({ method: methodMatch?.[1]?.toUpperCase() ?? "GET", path });
  }

  return calls;
}

export function findForbiddenOfficialEngineHttpMutations(
  source: string
): Array<{ method: string; path: string }> {
  return extractHttpCallsFromSource(source).filter((call) =>
    isOfficialEngineHttpMutationForbidden(call.method, call.path)
  );
}
