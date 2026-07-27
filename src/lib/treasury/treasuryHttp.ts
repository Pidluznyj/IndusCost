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
    case "MODULE_DISABLED":
    case "FEATURE_DISABLED":
      return 403;
    case "NOT_IMPLEMENTED":
      return 501;
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
  console.error("[treasury]", requestId, err);
  return sendTreasuryError(res, {
    requestId,
    error: "Erro interno na Central de Tesouraria.",
    code: "VALIDATION_ERROR",
  });
}
