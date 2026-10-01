/**
 * Reprocessamento de comissões em segundo plano.
 *
 * Prévia/aplicação recalculam pedido a pedido pelo motor oficial e, sem filtro,
 * analisam até 2000 pedidos — mais que os 100 s que o proxy aguarda (HTTP 524).
 * A rota inicia a rodada aqui, espera um prazo curto e, se não terminou,
 * devolve 202 com `jobId`; a tela acompanha por GET jobs/:jobId.
 *
 * Registro em memória do processo (a aplicação roda em um único processo Node).
 * Se o processo reiniciar, o job some e a tela pede para gerar de novo; a
 * auditoria da rodada continua em CommissionCalculationRun.
 */
import { randomUUID } from "node:crypto";
import type { CommissionReprocessJobRunning } from "./commissionReprocess.js";
import { CommissionReprocessError, type CommissionReprocessProgress } from "./commissionReprocess.server.js";
import { CommissionValidationError } from "./commissionApiValidation.js";

/** Quanto tempo o resultado fica disponível depois de pronto. */
export const COMMISSION_REPROCESS_JOB_RESULT_TTL_MS = 30 * 60 * 1000;

export type CommissionReprocessJobKind = "preview" | "apply";

export type CommissionReprocessJobError = { status: number; code: string | null; message: string };

export type CommissionReprocessJob<T = unknown> = {
  id: string;
  kind: CommissionReprocessJobKind;
  userId: string;
  status: "running" | "done" | "error";
  progress: CommissionReprocessProgress | null;
  result: T | null;
  error: CommissionReprocessJobError | null;
  startedAt: number;
  finishedAt: number | null;
  settled: Promise<void>;
};

const jobs = new Map<string, CommissionReprocessJob>();

function purgeExpired(now: number): void {
  for (const [id, job] of jobs) {
    if (job.finishedAt != null && now - job.finishedAt > COMMISSION_REPROCESS_JOB_RESULT_TTL_MS) {
      jobs.delete(id);
    }
  }
}

function toJobError(error: unknown, kind: CommissionReprocessJobKind): CommissionReprocessJobError {
  if (error instanceof CommissionReprocessError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof CommissionValidationError) {
    return { status: 400, code: error.code, message: error.message };
  }
  console.error(`commission reprocess job (${kind})`, error);
  return {
    status: 500,
    code: null,
    message:
      kind === "preview"
        ? "Erro ao gerar prévia de reprocessamento de comissões."
        : "Erro ao aplicar reprocessamento de comissões.",
  };
}

export function startCommissionReprocessJob<T>(
  kind: CommissionReprocessJobKind,
  userId: string,
  run: (onProgress: (progress: CommissionReprocessProgress) => void) => Promise<T>,
  now: () => number = Date.now
): CommissionReprocessJob<T> {
  purgeExpired(now());
  const job: CommissionReprocessJob<T> = {
    id: randomUUID(),
    kind,
    userId,
    status: "running",
    progress: null,
    result: null,
    error: null,
    startedAt: now(),
    finishedAt: null,
    settled: Promise.resolve(),
  };
  job.settled = (async () => {
    try {
      job.result = await run((progress) => {
        job.progress = progress;
      });
      job.status = "done";
    } catch (error) {
      job.error = toJobError(error, kind);
      job.status = "error";
    } finally {
      job.finishedAt = now();
    }
  })();
  jobs.set(job.id, job as CommissionReprocessJob);
  return job;
}

/** Só quem iniciou a rodada a enxerga. */
export function getCommissionReprocessJob(jobId: string, userId: string): CommissionReprocessJob | null {
  const job = jobs.get(jobId);
  return job && job.userId === userId ? job : null;
}

/** Espera a rodada terminar por até `ms`; devolve true se terminou. */
export async function waitForCommissionReprocessJob(job: CommissionReprocessJob, ms: number): Promise<boolean> {
  if (job.status !== "running") return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([job.settled, timeout]);
  if (timer) clearTimeout(timer);
  return job.status !== "running";
}

export function commissionReprocessJobRunningView(job: CommissionReprocessJob): CommissionReprocessJobRunning {
  return { jobId: job.id, kind: job.kind, status: "running", progress: job.progress };
}

/** Só para testes. */
export function clearCommissionReprocessJobsForTest(): void {
  jobs.clear();
}
