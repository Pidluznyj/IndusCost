/**
 * Cliente HTTP da ficha — credentials + no-store. Sem persistir remuneração no browser storage.
 */

export class ProfileHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function profileFetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: "Resposta inválida" };
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : `Erro ${res.status}`;
    throw new ProfileHttpError(message, res.status);
  }
  return body;
}

export async function profilePostJson(url: string, payload: Record<string, unknown>): Promise<unknown> {
  return profileFetchJson(url, { method: "POST", body: JSON.stringify(payload) });
}

export async function downloadEmployeeDocument(url: string, fileName: string): Promise<void> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ProfileHttpError(message, res.status);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName || "documento";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
