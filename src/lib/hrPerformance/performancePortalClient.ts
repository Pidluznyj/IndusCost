/**
 * Cliente do portal público (celular). Fica separado do cliente administrativo para que o
 * bundle de /avaliacao não leve nem os caminhos das rotas internas.
 */
const NO_STORE = { cache: "no-store" as const, credentials: "same-origin" as const };

async function publicCall<T>(path: string, init: RequestInit): Promise<T & { ok: boolean; message?: string; code?: string; offline?: boolean }> {
  try {
    const response = await fetch(path, { ...NO_STORE, ...init, headers: { "content-type": "application/json" } });
    if (response.status === 429) return { ok: false, code: "RATE_LIMIT", message: "Muitas tentativas. Espere um minuto e tente de novo." } as never;
    const body = await response.json().catch(() => ({ ok: false, message: "Resposta inválida do servidor." }));
    return body;
  } catch {
    return { ok: false, offline: true, code: "NETWORK", message: "Sem internet no momento. Sua resposta fica guardada e vamos tentar de novo." } as never;
  }
}

export type PublicForm = {
  employeeName: string;
  periodLabel: string;
  cycleName: string;
  instructions: string;
  questions: { code: string; text: string; pillar: string }[];
  answers: { questionCode: string; kind: string; score: number | null }[];
  version: number;
  status: string;
  assisted: boolean;
  expiresAt: string;
  dueAt: string;
};

export const openPerformanceInvite = (token: string) => publicCall<{ phase?: string }>("/api/public/performance/session", { method: "POST", body: JSON.stringify({ token }) });
export const claimAssistedPerformance = (token: string) => publicCall<{ phase?: string }>("/api/public/performance/assist", { method: "POST", body: JSON.stringify({ token }) });
export const verifyPerformanceOtp = (otp: string) => publicCall<object>("/api/public/performance/verify", { method: "POST", body: JSON.stringify({ otp }) });
export const fetchPerformanceForm = () => publicCall<Partial<PublicForm> & { expired?: boolean }>("/api/public/performance/form", { method: "GET" });
export const savePerformanceForm = (expectedVersion: number, answers: { code: string; answer: { kind: string; score?: number } }[]) =>
  publicCall<{ version?: number }>("/api/public/performance/answers", { method: "PUT", body: JSON.stringify({ expectedVersion, answers }) });
export const submitPerformanceForm = (expectedVersion: number, confirm: boolean) =>
  publicCall<{ status?: string }>("/api/public/performance/submit", { method: "POST", body: JSON.stringify({ expectedVersion, confirm }) });
export const logoutPerformancePortal = () => publicCall<object>("/api/public/performance/logout", { method: "POST", body: "{}" });
