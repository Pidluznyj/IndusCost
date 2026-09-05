import "dotenv/config";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactNomusUrlForLog,
} from "@/src/lib/nomusRestClient.js";
import {
  NOMUS_PURCHASE_ORDER_RESOURCE,
  buildPurchaseOrderPageParams,
} from "@/src/lib/nomus/nomusPurchaseOrderSyncLogic.js";
import { pickPurchaseOrderPageItems } from "@/src/lib/nomus/nomusPurchaseOrderSyncLogic.js";
import { mapNomusPurchaseOrderPayload } from "@/src/lib/nomus/nomusPurchaseOrderMapper.js";

const LOG_PREFIX = "[nomus-purchase-orders-probe]";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function sanitizeSample(raw: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (/(token|auth|password|secret|cnpj|cpf|telefone|email)/i.test(lower)) {
      clone[key] = value == null ? null : "<redigido>";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      clone[key] = sanitizeSample(value as Record<string, unknown>);
      continue;
    }
    if (Array.isArray(value)) {
      clone[key] = value.slice(0, 1).map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? sanitizeSample(item as Record<string, unknown>)
          : item
      );
      continue;
    }
    clone[key] = value;
  }
  return clone;
}

async function main() {
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const url = buildNomusUrl(baseUrl, NOMUS_PURCHASE_ORDER_RESOURCE, buildPurchaseOrderPageParams(1, 1));
  console.warn(`${LOG_PREFIX} endpoint=${redactNomusUrlForLog(url)}`);
  console.warn(
    `${LOG_PREFIX} credencial=${JSON.stringify(describeNomusCredential(process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN))}`
  );

  const started = Date.now();
  try {
    const payload = await fetchNomusJson(url, {
      logPrefix: LOG_PREFIX,
      maxRetries: 2,
      logContext: { resource: NOMUS_PURCHASE_ORDER_RESOURCE, page: 1 },
    });
    const items = pickPurchaseOrderPageItems(payload);
    const mapped = items[0] ? mapNomusPurchaseOrderPayload(items[0]) : null;
    const payloadKeys =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? Object.keys(payload as Record<string, unknown>)
        : [];

    console.warn(
      JSON.stringify(
        {
          ok: true,
          elapsedMs: Date.now() - started,
          resource: NOMUS_PURCHASE_ORDER_RESOURCE,
          payloadType: Array.isArray(payload) ? "array" : typeof payload,
          payloadKeys,
          recordsOnPage: items.length,
          sampleKeys: items[0] ? Object.keys(items[0]) : [],
          mappedOk: mapped?.ok ?? false,
          mappedStage: mapped?.ok ? mapped.row.stage : null,
          sample: items[0] ? sanitizeSample(items[0]) : null,
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusMatch = /HTTP\s+(\d{3})/.exec(message);
    console.error(
      JSON.stringify({
        ok: false,
        elapsedMs: Date.now() - started,
        httpStatus: statusMatch ? Number(statusMatch[1]) : null,
        error: message.slice(0, 300),
      })
    );
    process.exitCode = 1;
  }
}

void main();
