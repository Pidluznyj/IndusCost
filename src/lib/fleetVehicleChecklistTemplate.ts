import type { FleetReservationChecklistItemStatus } from "@prisma/client";

export type VehicleChecklistTemplateItem = {
  code: string;
  label: string;
};

export const FLEET_VEHICLE_CHECKLIST_TEMPLATE: VehicleChecklistTemplateItem[] = [
  { code: "LATERIA_DIANTEIRA", label: "Lataria dianteira" },
  { code: "LATERIA_TRASEIRA", label: "Lataria traseira" },
  { code: "LATERAL_ESQUERDA", label: "Lateral esquerda" },
  { code: "LATERAL_DIREITA", label: "Lateral direita" },
  { code: "PARA_CHOQUES", label: "Para-choques" },
  { code: "VIDROS", label: "Vidros" },
  { code: "RETROVISORES", label: "Retrovisores" },
  { code: "FAROIS_LANTERNAS", label: "Faróis e lanternas" },
  { code: "PNEUS", label: "Pneus" },
  { code: "ESTEPE_MACACO_TRIANGULO", label: "Estepe, macaco e triângulo" },
  { code: "LIMPADOR_PARABRISA", label: "Limpador de para-brisa" },
  { code: "INTERIOR_BANCOS", label: "Interior/bancos" },
  { code: "PAINEL_SEM_ALERTAS", label: "Painel sem alertas críticos" },
  { code: "DOCUMENTOS_VEICULO", label: "Documentos do veículo" },
  { code: "CHAVE_CONTROLE", label: "Chave/controle" },
  { code: "LIMPEZA_INTERNA", label: "Limpeza interna" },
  { code: "LIMPEZA_EXTERNA", label: "Limpeza externa" },
];

export const FLEET_VEHICLE_CHECKLIST_ITEM_STATUSES: FleetReservationChecklistItemStatus[] = [
  "OK",
  "ATENCAO",
  "AVARIA",
  "NAO_SE_APLICA",
];

export const FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT =
  "Confirmo que conferi o veículo e que as informações acima representam a condição do veículo neste momento.";

export type VehicleChecklistItemInput = {
  code: string;
  status: FleetReservationChecklistItemStatus;
  notes?: string | null;
};

export function validateVehicleChecklistItems(
  items: VehicleChecklistItemInput[]
): { ok: true } | { ok: false; message: string } {
  const templateCodes = new Set(FLEET_VEHICLE_CHECKLIST_TEMPLATE.map((t) => t.code));
  if (items.length !== FLEET_VEHICLE_CHECKLIST_TEMPLATE.length) {
    return { ok: false, message: "Informe todos os itens do checklist." };
  }

  const seen = new Set<string>();
  for (const item of items) {
    const code = item.code?.trim();
    if (!code || !templateCodes.has(code)) {
      return { ok: false, message: `Item inválido: ${code || "(vazio)"}.` };
    }
    if (seen.has(code)) {
      return { ok: false, message: `Item duplicado: ${code}.` };
    }
    seen.add(code);

    if (!FLEET_VEHICLE_CHECKLIST_ITEM_STATUSES.includes(item.status)) {
      return { ok: false, message: `Status inválido no item ${code}.` };
    }

    const notes = item.notes?.trim() ?? "";
    if ((item.status === "ATENCAO" || item.status === "AVARIA") && !notes) {
      return {
        ok: false,
        message: `Item "${code}" com ${item.status} exige observação.`,
      };
    }
    if (notes.length > 500) {
      return { ok: false, message: `Observação do item ${code} excede 500 caracteres.` };
    }
  }

  for (const t of FLEET_VEHICLE_CHECKLIST_TEMPLATE) {
    if (!seen.has(t.code)) {
      return { ok: false, message: `Falta o item obrigatório: ${t.label}.` };
    }
  }

  return { ok: true };
}
