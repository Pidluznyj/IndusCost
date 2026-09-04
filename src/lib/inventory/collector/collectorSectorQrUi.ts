/**
 * Helpers puros para a seção administrativa "QR de acesso ao Collector"
 * (Estoque → Dispositivos do Coletor).
 *
 * O backend (`GET /api/inventory/collector/sector-qr`) já resolve
 * autenticação, permissão e a URL pública absoluta — este módulo só entende o
 * payload/erro dessa resposta. Fica fora do componente React de propósito:
 * testável sem DOM/mock de fetch, seguindo a convenção do repo (ver
 * collectorSectorQrDeepLink.test.ts).
 */
import { isCollectorPublicBaseUrlErrorCode } from "./collectorPublicBaseUrl.js";

/** Único setor existente no contrato hoje — ver collectorSectorContract.ts. */
export const COLLECTOR_SECTOR_QR_DEFAULT_SECTOR = "RAW_MATERIAL";

/**
 * Monta a URL do endpoint de leitura. Não constrói o deep-link do QR em si —
 * isso é `response.url`, resolvido inteiramente pelo servidor.
 */
export function buildCollectorSectorQrEndpoint(
  sector: string = COLLECTOR_SECTOR_QR_DEFAULT_SECTOR
): string {
  return `/api/inventory/collector/sector-qr?sector=${encodeURIComponent(sector)}`;
}

export type CollectorSectorQrResponse = {
  sector: string;
  label: string;
  url: string;
};

export class CollectorSectorQrPayloadError extends Error {}

/**
 * Valida o formato real da resposta do backend. Nunca aceita `url` vazia —
 * um QR sem conteúdo não é um estado válido para renderizar.
 */
export function parseCollectorSectorQrPayload(data: unknown): CollectorSectorQrResponse {
  const o = (data ?? {}) as Record<string, unknown>;
  const sector = typeof o.sector === "string" ? o.sector.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!sector || !label || !url) {
    throw new CollectorSectorQrPayloadError(
      "Resposta inesperada do servidor para o QR do Collector."
    );
  }
  return { sector, label, url };
}

export type CollectorSectorQrErrorKind = "forbidden" | "config" | "generic";

export type CollectorSectorQrErrorClassification = {
  kind: CollectorSectorQrErrorKind;
  message: string;
};

const GENERIC_FALLBACK_MESSAGE = "Erro ao gerar o QR do Collector.";

const CONFIG_FALLBACK_MESSAGE =
  "Não foi possível gerar o QR do Collector porque a URL pública do Collector " +
  "não está configurada corretamente no servidor.";

/**
 * Classifica o erro da chamada para decidir o que a tela administrativa
 * mostra:
 *  - 401/403 → mesmo guard do backend; a seção fica oculta (o usuário já não
 *    deveria ter chegado à aba, mas nunca inventa um estado de sucesso);
 *  - COLLECTOR_PUBLIC_BASE_URL_REQUIRED/_INVALID → erro de CONFIGURAÇÃO do
 *    servidor, nunca um fallback de URL local;
 *  - qualquer outra coisa → erro genérico (rede/servidor).
 *
 * Preserva a mensagem oficial da API quando presente.
 */
export function classifyCollectorSectorQrError(error: {
  status?: number;
  code?: string | null;
  message?: string | null;
}): CollectorSectorQrErrorClassification {
  if (error.status === 401 || error.status === 403) {
    return { kind: "forbidden", message: error.message || GENERIC_FALLBACK_MESSAGE };
  }
  if (isCollectorPublicBaseUrlErrorCode(error.code)) {
    return { kind: "config", message: error.message || CONFIG_FALLBACK_MESSAGE };
  }
  return { kind: "generic", message: error.message || GENERIC_FALLBACK_MESSAGE };
}
