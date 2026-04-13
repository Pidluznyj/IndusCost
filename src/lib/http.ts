/**
 * Helpers mínimos para fetch com checagem de res.ok e mensagem útil a partir do JSON da API.
 */

export async function parseApiErrorMessage(res: Response): Promise<string> {
  const fallback = `Erro HTTP ${res.status}`;
  try {
    const ct = res.headers.get("content-type");
    if (ct?.includes("application/json")) {
      const data: unknown = await res.json();
      if (data && typeof data === "object") {
        const o = data as Record<string, unknown>;
        const msg = typeof o.message === "string" ? o.message.trim() : "";
        const err = typeof o.error === "string" ? o.error.trim() : "";
        // Preferir message: o backend costuma enviar error=CHILD_COST_FAILED e o detalhe útil em message.
        if (msg) return msg;
        if (err) return err;
        if (typeof o.details === "string" && o.details.trim()) return o.details;
      }
      return fallback;
    }
    const text = await res.text();
    return text?.trim().slice(0, 300) || fallback;
  } catch {
    return fallback;
  }
}

/** GET/POST etc. que retornam JSON no sucesso; lança Error se !res.ok */
export async function fetchJsonOk<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw new Error(await parseApiErrorMessage(res));
  }
  const ct = res.headers.get("content-type");
  if (ct?.includes("application/json")) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

/** Resposta sem corpo JSON obrigatório (ex.: DELETE); lança Error se !res.ok */
export async function fetchOk(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<void> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw new Error(await parseApiErrorMessage(res));
  }
}
