/**
 * Erros HTTP e observabilidade — Gestão de Frota (/api/fleet/*).
 * Negócio: 400/403/404/409/422 — nunca 500.
 * Técnico: 500 com mensagem segura (sem stack no JSON).
 */
import type express from "express";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";

/**
 * Detecção de erros do Prisma por duck-typing (sem importar @prisma/client,
 * que jamais pode entrar no bundle do navegador). Os erros do Prisma expõem
 * `name` e, no caso de request conhecida, um `code` (ex.: "P2002").
 */
function isPrismaKnownRequestError(
  error: unknown
): error is Error & { code: string } {
  return (
    error instanceof Error &&
    error.name === "PrismaClientKnownRequestError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function isPrismaInitializationError(error: unknown): boolean {
  return error instanceof Error && error.name === "PrismaClientInitializationError";
}

export const FLEET_SAFE_INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente ou contate o suporte.";

export const FLEET_FORBIDDEN_CODE = "FLEET_FORBIDDEN";

export type FleetHttpErrorBody = {
  error: string;
  code: string;
  retryable?: boolean;
};

export type FleetMappedError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  isBusiness: boolean;
};

/** Erro de negócio previsível com status HTTP explícito. */
export class FleetBusinessError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: string;
      httpStatus?: number;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "FleetBusinessError";
    const inferred = inferFleetErrorFromMessage(message);
    this.code = options.code ?? inferred.code;
    this.httpStatus = options.httpStatus ?? inferred.status;
    this.retryable = options.retryable ?? false;
  }
}

const SENSITIVE_LOG_RE =
  /(password|senha|token|cookie|authorization|set-cookie|secret|api[_-]?key)/i;

function redactForLog(value: string): string {
  if (SENSITIVE_LOG_RE.test(value)) return "[redacted]";
  return value;
}

/** Infere código e status a partir da mensagem (compatível com FleetValidationError legado). */
export function inferFleetErrorFromMessage(message: string): {
  status: number;
  code: string;
} {
  const m = message.toLowerCase();

  if (m.includes("conflito de reserva") || m.includes("já existe veículo ativo") || m.includes("já existe motorista ativo")) {
    return { status: 409, code: "FLEET_CONFLICT" };
  }
  if (m.includes("cnh vencida")) {
    return { status: 422, code: "FLEET_CNH_EXPIRED" };
  }
  if (m.includes("documento vencido")) {
    return { status: 422, code: "FLEET_DOCUMENT_EXPIRED" };
  }
  if (
    m.includes("bloqueado") ||
    m.includes("indisponível") ||
    m.includes("em manutenção") ||
    m.includes("em uso")
  ) {
    return { status: 422, code: "FLEET_VEHICLE_UNAVAILABLE" };
  }
  if (m.includes("sem permissão")) {
    return { status: 403, code: FLEET_FORBIDDEN_CODE };
  }
  if (m.includes("não encontrad")) {
    return { status: 404, code: "FLEET_NOT_FOUND" };
  }
  if (
    m.includes("km") ||
    m.includes("quilometragem") ||
    m.includes("negativ") ||
    m.includes("motivo") ||
    m.includes("obrigatór") ||
    m.includes("inválid")
  ) {
    return { status: 400, code: "FLEET_VALIDATION" };
  }
  return { status: 400, code: "FLEET_VALIDATION" };
}

export function mapFleetErrorToHttp(error: unknown): FleetMappedError {
  if (error instanceof FleetBusinessError) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      isBusiness: true,
    };
  }

  if (error instanceof FleetValidationError) {
    const inferred = inferFleetErrorFromMessage(error.message);
    return {
      status: inferred.status,
      code: error.code === "FLEET_VALIDATION" ? inferred.code : error.code,
      message: error.message,
      retryable: false,
      isBusiness: true,
    };
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === "P2002") {
      return {
        status: 409,
        code: "FLEET_UNIQUE_CONSTRAINT",
        message: "Registro duplicado. Verifique os dados informados.",
        retryable: false,
        isBusiness: true,
      };
    }
    if (error.code === "P2025") {
      return {
        status: 404,
        code: "FLEET_NOT_FOUND",
        message: "Registro não encontrado.",
        retryable: false,
        isBusiness: true,
      };
    }
    return {
      status: 500,
      code: "FLEET_DATABASE_ERROR",
      message: FLEET_SAFE_INTERNAL_MESSAGE,
      retryable: true,
      isBusiness: false,
    };
  }

  if (isPrismaInitializationError(error)) {
    return {
      status: 500,
      code: "FLEET_DATABASE_UNAVAILABLE",
      message: FLEET_SAFE_INTERNAL_MESSAGE,
      retryable: true,
      isBusiness: false,
    };
  }

  return {
    status: 500,
    code: "FLEET_INTERNAL_ERROR",
    message: FLEET_SAFE_INTERNAL_MESSAGE,
    retryable: true,
    isBusiness: false,
  };
}

export function logFleetTechnicalError(
  logLabel: string,
  error: unknown,
  req?: express.Request
): void {
  const mapped = mapFleetErrorToHttp(error);
  const payload: Record<string, unknown> = {
    module: "fleet",
    label: logLabel,
    code: mapped.code,
    status: mapped.status,
    method: req?.method,
    path: req?.originalUrl ?? req?.url,
  };
  if (error instanceof Error) {
    payload.errorName = error.name;
    payload.errorMessage = redactForLog(error.message);
  }
  console.error("[fleet:error]", JSON.stringify(payload));
  if (error instanceof Error && error.stack) {
    console.error("[fleet:error:stack]", error.stack.split("\n").slice(0, 8).join("\n"));
  }
}

/** Log estruturado para ações críticas bem-sucedidas (complementa FleetAuditLog). */
export function logFleetCriticalAction(input: {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string | null;
}): void {
  console.info(
    "[fleet:action]",
    JSON.stringify({
      module: "fleet",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: input.userId ?? null,
    })
  );
}

export function sendFleetErrorResponse(
  res: express.Response,
  error: unknown,
  context: { logLabel: string; req?: express.Request }
): express.Response {
  const mapped = mapFleetErrorToHttp(error);
  if (!mapped.isBusiness) {
    logFleetTechnicalError(context.logLabel, error, context.req);
  }
  const body: FleetHttpErrorBody = {
    error: mapped.message,
    code: mapped.code,
  };
  if (mapped.retryable) body.retryable = true;
  return res.status(mapped.status).json(body);
}

/** Handler padrão dos catch das rotas /api/fleet/*. */
export function handleFleetRouteError(
  res: express.Response,
  error: unknown,
  logLabel: string,
  req?: express.Request
): express.Response {
  return sendFleetErrorResponse(res, error, { logLabel, req });
}

/** @deprecated Use mapFleetErrorToHttp — mantido para testes legados. */
export function fleetValidationHttpStatus(message: string): number {
  return mapFleetErrorToHttp(new FleetValidationError(message)).status;
}
