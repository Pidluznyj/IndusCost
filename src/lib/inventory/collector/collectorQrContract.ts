/**
 * FASE 3 — contrato canônico do QR de LOCALIZAÇÃO do Stock Collector (legado
 * item × almoxarifado × endereço). Motor puro.
 *
 * LEGADO: o fluxo autônomo por setor usa deep-link em collectorSectorContract
 * (`/collector/sector/raw-material`). Este contrato permanece para etiquetas
 * por item e resolve-qr do CollectorPage clássico.
 *
 * O QR é um LOCALIZADOR, nunca uma credencial: identifica item × almoxarifado
 * × endereço com os UUIDs canônicos do Inventory e nada mais. Não contém
 * segredo, userId, deviceId, actorType nem identidade Tailscale — fotografar
 * ou copiar um QR não dá acesso a nada: a autorização continua sendo
 * Tailscale identity + Device Registry, e a contagem continua passando por
 * recordInventoryCount.
 *
 * DECISÃO (tamper/assinatura): sem HMAC. O servidor revalida TODOS os IDs
 * contra o banco a cada resolução (existência, status ativo, pertencimento ao
 * almoxarifado e à sessão) — um QR inventado só consegue apontar para uma
 * combinação que já é válida e pública dentro do tailnet autorizado, o que é
 * exatamente o que um QR legítimo faz. Assinatura acrescentaria gestão de
 * chave sem acrescentar segurança; se um dia o QR carregar algo além de
 * localizador, essa decisão deve ser revisitada.
 */
import { InventoryValidationError } from "./../inventoryTypes.js";

export const COLLECTOR_QR_VERSION = 1;
/** Discriminador do tipo de QR — deixa espaço para outros QRs no futuro. */
export const COLLECTOR_QR_TYPE = "inv-loc";

export const QR_INVALID = "QR_INVALID";
export const QR_VERSION_UNSUPPORTED = "QR_VERSION_UNSUPPORTED";

export type CollectorQrPayload = {
  v: typeof COLLECTOR_QR_VERSION;
  t: typeof COLLECTOR_QR_TYPE;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Texto impresso no QR — JSON com ordem de chaves fixa (determinístico). */
export function buildCollectorQrText(input: {
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
}): string {
  if (!UUID_RE.test(input.itemId) || !UUID_RE.test(input.warehouseId)) {
    throw new InventoryValidationError("Identificadores inválidos para o QR.", QR_INVALID);
  }
  if (input.locationId != null && !UUID_RE.test(input.locationId)) {
    throw new InventoryValidationError("Endereço inválido para o QR.", QR_INVALID);
  }
  return JSON.stringify({
    v: COLLECTOR_QR_VERSION,
    t: COLLECTOR_QR_TYPE,
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    locationId: input.locationId ?? null,
  });
}

/**
 * Interpreta o texto escaneado. Fail-closed: qualquer desvio → erro. Campos
 * extras são IGNORADOS — a identidade logística sai exclusivamente de
 * itemId/warehouseId/locationId; nada de deviceId/actorType/segredo entra
 * aqui, venha o que vier no texto.
 */
export function parseCollectorQrText(text: unknown): CollectorQrPayload {
  if (typeof text !== "string" || !text.trim()) {
    throw new InventoryValidationError("QR vazio ou ilegível.", QR_INVALID);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new InventoryValidationError("QR não reconhecido.", QR_INVALID);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InventoryValidationError("QR não reconhecido.", QR_INVALID);
  }
  const data = raw as Record<string, unknown>;

  if (data.v !== COLLECTOR_QR_VERSION) {
    throw new InventoryValidationError(
      "Versão de QR não suportada. Reimprima a etiqueta.",
      QR_VERSION_UNSUPPORTED
    );
  }
  if (data.t !== COLLECTOR_QR_TYPE) {
    throw new InventoryValidationError("QR não é de localização de estoque.", QR_INVALID);
  }
  if (typeof data.itemId !== "string" || !UUID_RE.test(data.itemId)) {
    throw new InventoryValidationError("QR com item inválido.", QR_INVALID);
  }
  if (typeof data.warehouseId !== "string" || !UUID_RE.test(data.warehouseId)) {
    throw new InventoryValidationError("QR com almoxarifado inválido.", QR_INVALID);
  }
  let locationId: string | null = null;
  if (data.locationId != null) {
    if (typeof data.locationId !== "string" || !UUID_RE.test(data.locationId)) {
      throw new InventoryValidationError("QR com endereço inválido.", QR_INVALID);
    }
    locationId = data.locationId;
  }

  return {
    v: COLLECTOR_QR_VERSION,
    t: COLLECTOR_QR_TYPE,
    itemId: data.itemId,
    warehouseId: data.warehouseId,
    locationId,
  };
}
