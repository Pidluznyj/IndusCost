/**
 * Helpers HTTP da Tesouraria (erros padronizados + requestId).
 * Sem Prisma.
 */

import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  TreasuryContractError,
  type TreasuryErrorCode,
} from "./contracts/treasuryErrorCodes.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  sanitizeTreasuryLogMessage,
  sanitizeTreasuryLogValue,
} from "./domain/treasurySecurityRules.js";

export type TreasuryApiErrorBody = {
  error: string;
  code: TreasuryErrorCode | string;
  field?: string;
  requestId: string;
};

export function resolveTreasuryRequestId(req: Request): string {
  const header =
    req.header("x-request-id") ??
    req.header("x-correlation-id") ??
    (typeof req.query.requestId === "string" ? req.query.requestId : null);
  const trimmed = header?.trim();
  if (trimmed) return trimmed.slice(0, 128);
  return randomUUID();
}

export function treasuryErrorStatus(code: string): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "DAY_CLOSED":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "MODULE_DISABLED":
    case "FEATURE_DISABLED":
      return 403;
    case "NOT_IMPLEMENTED":
      return 501;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 400;
  }
}

export function sendTreasuryError(
  res: Response,
  input: {
    requestId: string;
    error: string;
    code: TreasuryErrorCode | string;
    field?: string;
  }
): Response {
  const body: TreasuryApiErrorBody = {
    error: input.error,
    code: input.code,
    requestId: input.requestId,
  };
  if (input.field) body.field = input.field;
  return res.status(treasuryErrorStatus(input.code)).json(body);
}

export function handleTreasuryRouteError(
  res: Response,
  requestId: string,
  err: unknown
): Response {
  if (err instanceof TreasuryDomainError || err instanceof TreasuryContractError) {
    return sendTreasuryError(res, {
      requestId,
      error: err.message,
      code: err.code,
      field: err.field,
    });
  }
  console.error(
    "[treasury]",
    requestId,
    sanitizeTreasuryLogValue(
      err instanceof Error
        ? { name: err.name, message: sanitizeTreasuryLogMessage(err.message) }
        : err
    )
  );
  // Exceção não prevista é falha do SERVIDOR (500), não do cliente (400).
  // Devolver VALIDATION_ERROR aqui fazia um crash interno aparecer como
  // "Bad Request" no navegador, escondia a causa e contava como erro do
  // cliente no monitoramento. O detalhe do erro fica só no log do servidor
  // (acima, já sanitizado); o requestId vai na mensagem para permitir
  // correlacionar tela e log sem expor interno ao usuário.
  return sendTreasuryError(res, {
    requestId,
    error: `Erro interno na Central de Tesouraria. Referência: ${requestId}`,
    code: "INTERNAL_ERROR",
  });
}
