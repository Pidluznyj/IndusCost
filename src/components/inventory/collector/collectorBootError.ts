/**
 * Mapeamento de erros do boot do Collector (UX).
 * Config/operacional NÃO vira "unauthorized".
 */
export type CollectorBootPhase =
  | "checking"
  | "unauthorized"
  | "configuration_error"
  | "error"
  | "ready";

const CONFIG_CODES = new Set([
  "CONFIGURATION_REQUIRED",
  "COLLECTOR_NO_WAREHOUSE_FOR_SECTOR",
  "COLLECTOR_NO_ITEMS",
  "COLLECTOR_NO_LINES",
  "COLLECTOR_NO_ELIGIBLE_ITEMS",
  "NO_ELIGIBLE_ITEMS",
  "WAREHOUSE_REQUIRED",
  "WAREHOUSE_NOT_ELIGIBLE",
  "WAREHOUSE_NOT_FOUND",
  "WAREHOUSE_INACTIVE",
]);

const UNAUTH_CODES = new Set([
  "COLLECTOR_DEVICE_UNAUTHORIZED",
  "NOT_AUTHORIZED",
  "COLLECTOR_CAPABILITY_DENIED",
]);

export function mapCollectorBootError(input: {
  status: number | null;
  code: string | null;
  message: string | null;
  networkFailure?: boolean;
}): {
  phase: Exclude<CollectorBootPhase, "checking" | "ready">;
  message: string;
} {
  if (input.networkFailure) {
    return {
      phase: "error",
      message: input.message?.trim() || "Falha de rede ao contatar o Collector.",
    };
  }

  const status = input.status;
  const code = (input.code ?? "").trim();

  if (
    status === 401 ||
    status === 403 ||
    UNAUTH_CODES.has(code)
  ) {
    return {
      phase: "unauthorized",
      message:
        input.message?.trim() ||
        "Este aparelho não está liberado para contagem. Acione o supervisor de estoque.",
    };
  }

  if (
    CONFIG_CODES.has(code) ||
    status === 400
  ) {
    // 400 genérico de contexto: preferir configuration_error se código conhecido;
    // se não houver código, ainda assim não chamar de unauthorized.
    if (!code || CONFIG_CODES.has(code) || status === 400) {
      return {
        phase: "configuration_error",
        message:
          input.message?.trim() ||
          "Configuração de estoque incompleta para iniciar a contagem.",
      };
    }
  }

  if (status != null && status >= 500) {
    return {
      phase: "error",
      message: input.message?.trim() || "Erro interno ao carregar o Collector.",
    };
  }

  return {
    phase: "error",
    message: input.message?.trim() || "Não foi possível iniciar o Collector.",
  };
}

export function mapOperationalStateToBootHint(
  operationalState: string | null | undefined
): "configuration_error" | null {
  if (
    operationalState === "CONFIGURATION_REQUIRED" ||
    operationalState === "NO_ELIGIBLE_ITEMS"
  ) {
    return "configuration_error";
  }
  return null;
}
