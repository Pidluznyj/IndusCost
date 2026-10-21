/**
 * Classifica o retorno HTTP + metaDados da Direct Data API v3.
 * Fonte: quickstart (status HTTP) e tabela oficial de metaDados.resultado
 * (cobrado vs não cobrado). Saldo e plano são do provedor, não do IndusCost.
 */

export type DirectDataCharge = "yes" | "no" | "unknown";

export type DirectDataProviderOutcome =
  | "SUCCESS"
  | "INSUFFICIENT_BALANCE"
  | "AUTH"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "INVALID_INPUT"
  | "HTTP_ERROR"
  | "NETWORK";

export type ClassifiedDirectDataResponse = {
  outcome: DirectDataProviderOutcome;
  charge: DirectDataCharge;
  status: number | null;
  body: unknown;
  resultado: string | null;
  mensagem: string | null;
};

const NOT_CHARGED = new Set([
  "SaldoInsuficiente",
  "AcessoNegado",
  "SistemaRemotoIndisponivel",
  "TempoEsgotado",
  "TentativasEsgotadas",
  "ErroSistemaRemoto",
  "ParametrosInvalidos",
  "ParametrosNaoSuportados",
  "DocumentoEntradaInvalida",
  "ConsultaIndisponivel",
  "ErroInterno",
  "FalhaAoRealizarConsulta",
  "MaxTimeOut",
  "LimiteSimultaneasAtingido",
  "SucessoNaoFaturavel",
]);

const CHARGED = new Set(["Sucesso", "SucessoComRessalvas", "DocumentoEntidadeNaoEncontrada"]);

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function readDirectDataMeta(body: unknown): { resultado: string | null; mensagem: string | null } {
  const root = record(body);
  const meta = record(root?.metaDados) ?? root;
  return {
    resultado: text(meta?.resultado),
    mensagem: text(meta?.mensagem) ?? text(root?.mensagem) ?? text(root?.error) ?? text(root?.erro),
  };
}

function foldResultado(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, "");
}

function looksLikeInsufficientBalance(resultado: string | null, mensagem: string | null): boolean {
  const folded = foldResultado(resultado);
  if (folded && /^SaldoInsuficiente$/i.test(folded)) return true;
  const textValue = `${resultado ?? ""} ${mensagem ?? ""}`.toLocaleLowerCase("pt-BR");
  return (
    /saldo insuficiente/.test(textValue) ||
    /n[aã]o existe um plano ativo/.test(textValue) ||
    /sem saldo/.test(textValue)
  );
}

function outcomeFromResultado(resultado: string | null): DirectDataProviderOutcome | null {
  const folded = foldResultado(resultado);
  if (!folded) return null;
  const table: Record<string, DirectDataProviderOutcome> = {
    Sucesso: "SUCCESS",
    SucessoComRessalvas: "SUCCESS",
    SucessoNaoFaturavel: "SUCCESS",
    DocumentoEntidadeNaoEncontrada: "SUCCESS",
    SaldoInsuficiente: "INSUFFICIENT_BALANCE",
    AcessoNegado: "AUTH",
    SistemaRemotoIndisponivel: "UNAVAILABLE",
    ConsultaIndisponivel: "UNAVAILABLE",
    ErroSistemaRemoto: "UNAVAILABLE",
    ErroInterno: "UNAVAILABLE",
    FalhaAoRealizarConsulta: "UNAVAILABLE",
    TempoEsgotado: "TIMEOUT",
    TentativasEsgotadas: "TIMEOUT",
    MaxTimeOut: "TIMEOUT",
    LimiteSimultaneasAtingido: "RATE_LIMIT",
    ParametrosInvalidos: "INVALID_INPUT",
    ParametrosNaoSuportados: "INVALID_INPUT",
    DocumentoEntradaInvalida: "INVALID_INPUT",
    EmProcessamento: "HTTP_ERROR",
  };
  const exact = Object.keys(table).find((key) => key.toLowerCase() === folded.toLowerCase());
  return exact ? table[exact] ?? null : null;
}

function chargeFromResultado(resultado: string | null, outcome: DirectDataProviderOutcome): DirectDataCharge {
  const folded = foldResultado(resultado);
  if (folded) {
    const charged = [...CHARGED].find((key) => key.toLowerCase() === folded.toLowerCase());
    if (charged) return "yes";
    const notCharged = [...NOT_CHARGED].find((key) => key.toLowerCase() === folded.toLowerCase());
    if (notCharged) return "no";
    if (folded.toLowerCase() === "emprocessamento") return "unknown";
  }
  if (outcome === "SUCCESS") return "yes";
  if (
    outcome === "INSUFFICIENT_BALANCE" ||
    outcome === "AUTH" ||
    outcome === "INVALID_INPUT" ||
    outcome === "UNAVAILABLE"
  ) {
    return "no";
  }
  return "unknown";
}

function outcomeFromHttp(status: number, mensagem: string | null, resultado: string | null): DirectDataProviderOutcome {
  if (looksLikeInsufficientBalance(resultado, mensagem)) return "INSUFFICIENT_BALANCE";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMIT";
  if (status === 503) return "UNAVAILABLE";
  if (status === 400 || status === 404 || status === 422) return "INVALID_INPUT";
  if (status >= 500) return "HTTP_ERROR";
  if (status >= 200 && status < 300) return "SUCCESS";
  return "HTTP_ERROR";
}

export function classifyDirectDataHttpResponse(status: number, body: unknown): ClassifiedDirectDataResponse {
  const meta = readDirectDataMeta(body);
  const fromResultado = outcomeFromResultado(meta.resultado);
  const outcome =
    looksLikeInsufficientBalance(meta.resultado, meta.mensagem)
      ? "INSUFFICIENT_BALANCE"
      : fromResultado ?? outcomeFromHttp(status, meta.mensagem, meta.resultado);
  let charge = chargeFromResultado(meta.resultado, outcome);
  if (!meta.resultado) {
    if (outcome === "SUCCESS") charge = "yes";
    else if (status === 401 || status === 403 || status === 400 || status === 404 || status === 408 || status === 503) {
      charge = "no";
    } else {
      charge = "unknown";
    }
  }
  return {
    outcome,
    charge,
    status,
    body,
    resultado: meta.resultado,
    mensagem: meta.mensagem,
  };
}

export function classifyDirectDataNetworkError(error: unknown): ClassifiedDirectDataResponse {
  const name = error instanceof Error ? error.name : "";
  const outcome: DirectDataProviderOutcome = name === "AbortError" ? "TIMEOUT" : "NETWORK";
  return {
    outcome,
    charge: "unknown",
    status: null,
    body: null,
    resultado: null,
    mensagem: null,
  };
}

export function paidQueryCodeFromProvider(result: ClassifiedDirectDataResponse): {
  code:
    | "OK"
    | "INSUFFICIENT_BALANCE"
    | "AUTH"
    | "UNAVAILABLE"
    | "TIMEOUT"
    | "RATE_LIMIT"
    | "INVALID_INPUT"
    | "HTTP_ERROR"
    | "NETWORK";
  persist: "success" | "failed_not_sent" | "unknown";
} {
  if (result.outcome === "SUCCESS") {
    return { code: "OK", persist: result.charge === "unknown" ? "unknown" : "success" };
  }
  const code =
    result.outcome === "INSUFFICIENT_BALANCE" ||
    result.outcome === "AUTH" ||
    result.outcome === "UNAVAILABLE" ||
    result.outcome === "TIMEOUT" ||
    result.outcome === "RATE_LIMIT" ||
    result.outcome === "INVALID_INPUT" ||
    result.outcome === "HTTP_ERROR" ||
    result.outcome === "NETWORK"
      ? result.outcome
      : "HTTP_ERROR";
  if (result.charge === "no") return { code, persist: "failed_not_sent" };
  return { code, persist: "unknown" };
}
