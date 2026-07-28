/**
 * Cliente HTTP → Power Automate. Não loga secret nem payload completo.
 */
import { readMaterialStockSpreadsheetMirrorConfig } from "./config.js";
import { assertMirrorPayloadHasNoCosts } from "./queueRules.js";
import { validateMaterialStockSpreadsheetWebhookUrl } from "./urlAllowlist.js";
import type { MaterialStockSpreadsheetMirrorPayload } from "./types.js";

export type MirrorWebhookDeliveryResult =
  | { ok: true; status: number }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      status?: number;
    };

export type MirrorWebhookFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function deliverMaterialStockSpreadsheetMirrorWebhook(
  payload: MaterialStockSpreadsheetMirrorPayload,
  deps?: {
    fetchImpl?: MirrorWebhookFetch;
    config?: ReturnType<typeof readMaterialStockSpreadsheetMirrorConfig>;
  }
): Promise<MirrorWebhookDeliveryResult> {
  const config = deps?.config ?? readMaterialStockSpreadsheetMirrorConfig();
  const fetchImpl = deps?.fetchImpl ?? fetch;

  if (!config.enabled) {
    return {
      ok: false,
      code: "MIRROR_DISABLED",
      message: "Espelho desabilitado (MATERIAL_STOCK_SPREADSHEET_MIRROR_ENABLED).",
      retryable: true,
    };
  }

  if (!config.webhookSecret) {
    return {
      ok: false,
      code: "SECRET_MISSING",
      message: "Segredo do webhook ausente.",
      retryable: false,
    };
  }

  const destination = validateMaterialStockSpreadsheetWebhookUrl(
    config.webhookUrl,
    config.allowedHosts
  );
  if (destination.ok === false) {
    return {
      ok: false,
      code: destination.code,
      message: destination.message,
      retryable: false,
    };
  }

  const asRecord = payload as unknown as Record<string, unknown>;
  const costs = assertMirrorPayloadHasNoCosts(asRecord);
  if (costs.ok === false) {
    return {
      ok: false,
      code: "PAYLOAD_HAS_COSTS",
      message: "Payload contém chaves de custo proibidas.",
      retryable: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
  try {
    const response = await fetchImpl(destination.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-IndusCost-Webhook-Secret": config.webhookSecret,
        "X-Idempotency-Key": payload.idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "manual",
    });

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status };
    }

    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    return {
      ok: false,
      code: `HTTP_${response.status}`,
      message: `Webhook respondeu ${response.status}.`,
      retryable,
      status: response.status,
    };
  } catch (error) {
    const aborted =
      error instanceof Error &&
      (error.name === "AbortError" || /aborted/i.test(error.message));
    return {
      ok: false,
      code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
      message: aborted
        ? "Timeout ao chamar webhook."
        : "Falha de rede ao chamar webhook.",
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
