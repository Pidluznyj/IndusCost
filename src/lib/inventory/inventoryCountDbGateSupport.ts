/**
 * OP-10 — suporte comum aos gates que exigem PostgreSQL real.
 *
 * Vive fora dos arquivos .test para que os harnesses (temporal e semântico)
 * compartilhem UMA implementação da guarda de segurança sem que importar um
 * deles execute as suítes do outro.
 *
 * Regra inegociável: os gates escrevem dados, então só rodam contra banco
 * DESCARTÁVEL apontado explicitamente por INVENTORY_TEMPORAL_DB_URL. Nunca há
 * fallback para DATABASE_URL.
 */

export const DB_GATE_PENDING =
  "DB_GATE_PENDING — defina INVENTORY_TEMPORAL_DB_URL (PostgreSQL descartável) para executar";

/** Token obrigatório no nome do banco — trava contra apontar para banco oficial. */
export const TEMPORAL_DB_NAME_TOKEN = "inventory_temporal_gate";

/** PostgreSQL oficial da infraestrutura onde estes gates são executados. */
export const EXPECTED_POSTGRES_MAJOR = 17;

/** URL do banco de teste. Opt-in explícito, sem fallback para DATABASE_URL. */
export function resolveTemporalDbUrl(): string | null {
  const url = process.env.INVENTORY_TEMPORAL_DB_URL?.trim();
  return url ? url : null;
}

/** Extrai só o nome do banco — nunca devolve credencial. */
export function temporalDbName(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

/**
 * Guarda de segurança: o alvo tem de ser inequivocamente descartável.
 * Lança (aborta o gate) em vez de degradar para skip.
 */
export function assertDisposableTemporalDb(url: string): string {
  const name = temporalDbName(url);
  if (!name) {
    throw new Error("INVENTORY_TEMPORAL_DB_URL sem nome de banco — ABORTADO.");
  }
  if (!name.includes(TEMPORAL_DB_NAME_TOKEN)) {
    throw new Error(
      `ABORTADO: banco "${name}" não contém "${TEMPORAL_DB_NAME_TOKEN}". ` +
        "Os DB gates escrevem dados e só rodam em banco descartável."
    );
  }
  return name;
}

/** Major do PostgreSQL a partir de `server_version` (ex.: "17.2" → 17). */
export function parsePostgresMajor(serverVersion: string | undefined | null): number {
  return Number.parseInt(String(serverVersion ?? "").split(".")[0], 10);
}
