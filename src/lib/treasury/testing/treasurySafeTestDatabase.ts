/**
 * Gate de banco de teste seguro da Tesouraria.
 * Nunca aponta para produção; falha fechado se a URL for suspeita.
 */

export const TREASURY_TEST_DATABASE_ENV = "TREASURY_TEST_DATABASE_URL" as const;

const PRODUCTION_HOST_RE =
  /(induscost\.|lazarios\.|\.prod\.|production|\/opt\/induscost|rds\.amazonaws\.com)/i;

const SAFE_HINT_RE =
  /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\/treasury[_-]?test|[_-]test([_/]|$)|test[_-]treasury)/i;

export type TreasurySafeTestDatabaseMode =
  | { mode: "in_process"; reason: string }
  | { mode: "external"; url: string };

export function assertTreasurySafeTestDatabaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("TREASURY_TEST_DATABASE_URL vazia.");
  }
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    throw new Error(
      "TREASURY_TEST_DATABASE_URL deve ser postgresql:// (banco de teste)."
    );
  }
  if (PRODUCTION_HOST_RE.test(trimmed)) {
    throw new Error(
      "Recusado: TREASURY_TEST_DATABASE_URL parece apontar para produção."
    );
  }
  if (!SAFE_HINT_RE.test(trimmed)) {
    throw new Error(
      "Recusado: URL de teste deve conter localhost/127.0.0.1 ou marcador '_test'/'treasury_test'."
    );
  }
  return trimmed;
}

/**
 * Resolve modo de execução:
 * - sem env → banco de teste in-process (sempre seguro, executável sem Docker)
 * - com env válida → Postgres externo de teste
 */
export function resolveTreasurySafeTestDatabaseMode(
  env: NodeJS.ProcessEnv = process.env
): TreasurySafeTestDatabaseMode {
  const raw = env[TREASURY_TEST_DATABASE_ENV]?.trim();
  if (!raw) {
    return {
      mode: "in_process",
      reason:
        "TREASURY_TEST_DATABASE_URL ausente — usando banco de teste in-process (não produção).",
    };
  }
  const url = assertTreasurySafeTestDatabaseUrl(raw);
  return { mode: "external", url };
}

export function isTreasurySafeTestDatabaseEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveTreasurySafeTestDatabaseMode(env).mode === "external";
}

/** Snapshot JSON profundo para rollback de TX no banco in-process. */
export function cloneTreasuryTestState<T>(value: T): T {
  return structuredClone(value);
}
