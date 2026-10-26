/**
 * Rede de segurança HTTP do servidor (Express 4).
 *
 * Incidente de 26/10/2026 (produção, 9d46d87a): `POST /api/customers` rejeitou com P2002 (CNPJ já cadastrado).
 * O Express 4 não captura promessas rejeitadas de handlers `async`: a rejeição virou `unhandledRejection`, o Node
 * encerrou com código 1, o systemd reiniciou o serviço e todos os usuários receberam 502.
 *
 * 1. `installExpressAsyncErrorForwarding` — toda rejeição de handler/middleware `async` (de `app` e de qualquer
 *    `express.Router`) vai para `next(err)`, como um `throw` síncrono já ia.
 * 2. `createGlobalErrorHandler` — resposta controlada: 4xx explícitos preservados, P2002 → 409, P2025 → 404,
 *    demais → 500 sem detalhes internos em produção (o log do servidor mantém o erro completo).
 * 3. `installProcessSafetyNet` — promessa rejeitada sem tratamento fora do ciclo da requisição (tarefa em segundo
 *    plano) é registrada sem derrubar o processo; exceção síncrona não capturada segue o padrão do Node.
 */
import { createRequire } from "node:module";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";

type LayerLike = {
  handle: (...args: unknown[]) => unknown;
  handle_request: (req: Request, res: Response, next: NextFunction) => void;
  handle_error: (err: unknown, req: Request, res: Response, next: NextFunction) => void;
};

const INSTALLED = Symbol.for("induscost.expressAsyncErrorForwarding");

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as { then?: unknown }).then === "function";
}

function rejectionToError(reason: unknown): unknown {
  return reason ?? new Error("Promessa rejeitada sem motivo");
}

/** Idempotente. Reproduz o comportamento do Layer do Express 4 e acrescenta o encaminhamento de rejeições. */
export function installExpressAsyncErrorForwarding(): void {
  const require = createRequire(import.meta.url);
  const Layer = require("express/lib/router/layer") as { prototype: LayerLike & { [INSTALLED]?: true } };
  if (Layer.prototype[INSTALLED]) return;

  Layer.prototype.handle_request = function handleRequest(this: LayerLike, req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      const result = fn(req, res, next);
      if (isThenable(result)) result.then(undefined, (reason) => next(rejectionToError(reason)));
    } catch (err) {
      next(err);
    }
  };

  Layer.prototype.handle_error = function handleError(this: LayerLike, error, req, res, next) {
    const fn = this.handle;
    if (fn.length !== 4) return next(error);
    try {
      const result = fn(error, req, res, next);
      if (isThenable(result)) result.then(undefined, (reason) => next(rejectionToError(reason)));
    } catch (err) {
      next(err);
    }
  };

  Layer.prototype[INSTALLED] = true;
}

/** Código Prisma (P2002 etc.) sem depender da classe — vale também para erros vindos de transações. */
export function prismaErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

/** Nome/código para log, sem mensagem (que pode conter dados do registro). */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    const code = prismaErrorCode(error) ?? (error as { code?: unknown }).code;
    return code ? `${error.name}(${String(code)})` : error.name;
  }
  return typeof error;
}

function explicitHttpStatus(error: unknown): number | null {
  const e = error as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : null;
  return status != null && status >= 400 && status < 600 ? status : null;
}

export type GlobalErrorHandlerOptions = {
  production?: boolean;
  log?: (label: string, error: unknown) => void;
};

export function createGlobalErrorHandler(options: GlobalErrorHandlerOptions = {}): ErrorRequestHandler {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const log = options.log ?? ((label, error) => console.error(label, error));
  return (err, req, res, next) => {
    log(`Express Error: ${req.method} ${req.originalUrl ?? req.url}`, err);
    // Resposta já começou: só o Express pode encerrar a conexão.
    if (res.headersSent) return next(err);

    const prismaCode = prismaErrorCode(err);
    if (prismaCode === "P2002") {
      return res.status(409).json({
        error: "UNIQUE_CONSTRAINT_VIOLATION",
        code: "UNIQUE_CONSTRAINT_VIOLATION",
        message: "Já existe um registro com estes dados.",
      });
    }
    if (prismaCode === "P2025") {
      return res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND", message: "Registro não encontrado." });
    }

    const status = explicitHttpStatus(err);
    if (status != null && status < 500) {
      // Erros 4xx explícitos (ex.: corpo JSON inválido, limite de tamanho) têm mensagem pública.
      const message = err instanceof Error && err.message ? err.message : "Requisição inválida.";
      return res.status(status).json({ error: message, message });
    }

    if (production || prismaCode != null) {
      return res.status(status ?? 500).json({
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message: "Erro interno do servidor. Tente novamente; se persistir, avise o suporte.",
      });
    }
    return res.status(status ?? 500).json({
      error: err instanceof Error && err.message ? err.message : "Internal Server Error",
      stack: err instanceof Error ? err.stack : undefined,
    });
  };
}

const SAFETY_NET = Symbol.for("induscost.processSafetyNet");

/** Idempotente. Registra rejeições sem tratamento sem derrubar o processo. */
export function installProcessSafetyNet(log: (message: string, error: unknown) => void = (m, e) => console.error(m, e)): void {
  const proc = process as NodeJS.Process & { [SAFETY_NET]?: true };
  if (proc[SAFETY_NET]) return;
  proc[SAFETY_NET] = true;
  process.on("unhandledRejection", (reason) => {
    log(`[unhandledRejection] ${describeErrorForLog(reason)} — processo mantido`, reason);
  });
}
