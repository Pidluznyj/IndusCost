/**
 * Formulário de empresas monitoradas.
 * Só monta payload das rotas já existentes. Não consulta fonte externa.
 */

import { normalizeCnpj } from "@/src/lib/companyCnpjFormat";

export type MonitoredEntity = {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  active: boolean;
  state: string | null;
  city: string | null;
  monitorDomicilio: boolean;
  monitorDatajud: boolean;
  monitorDjen: boolean;
  monitorCertificates: boolean;
  domicilioTenantId: string | null;
  lastSuccessfulSyncAt: string | null;
};

export type EntityCreateForm = {
  cnpj: string;
  legalName: string;
  tradeName: string;
  state: string;
  city: string;
};

export type EntityEditForm = {
  legalName: string;
  tradeName: string;
  state: string;
  city: string;
  active: boolean;
  monitorDomicilio: boolean;
  monitorDatajud: boolean;
  monitorDjen: boolean;
  monitorCertificates: boolean;
};

export type EntityCreateBody = {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  state: string | null;
  city: string | null;
};

export type EntityUpdateBody = {
  legalName: string;
  tradeName: string | null;
  state: string | null;
  city: string | null;
  active: boolean;
  monitorDomicilio: boolean;
  monitorDatajud: boolean;
  monitorDjen: boolean;
  monitorCertificates: boolean;
};

export const EMPTY_COMPANIES_COPY = "Nenhuma empresa cadastrada para monitoramento.";
export const EMPTY_COMPANIES_MANAGE_HINT =
  "Cadastre uma empresa do grupo para iniciar o monitoramento jurídico.";
export const MONITOR_GLOBAL_NOTE =
  "As fontes somente serão consultadas quando estiverem configuradas e habilitadas globalmente.";

const ENTITY_COLLECTION = "/api/legal-exposure/entities";

export function maskCnpjInput(value: string): string {
  const digits = normalizeCnpj(value).slice(0, 14);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `.${digits.slice(2, 5)}`;
  if (digits.length > 5) out += `.${digits.slice(5, 8)}`;
  if (digits.length > 8) out += `/${digits.slice(8, 12)}`;
  if (digits.length > 12) out += `-${digits.slice(12, 14)}`;
  return out;
}

export function emptyCreateForm(): EntityCreateForm {
  return { cnpj: "", legalName: "", tradeName: "", state: "", city: "" };
}

export function entityEditFormFrom(entity: MonitoredEntity): EntityEditForm {
  return {
    legalName: entity.legalName,
    tradeName: entity.tradeName ?? "",
    state: entity.state ?? "",
    city: entity.city ?? "",
    active: entity.active,
    monitorDomicilio: entity.monitorDomicilio,
    monitorDatajud: entity.monitorDatajud,
    monitorDjen: entity.monitorDjen,
    monitorCertificates: entity.monitorCertificates,
  };
}

export function exposureEntityActions(canManage: boolean) {
  return { showAdd: canManage, showEdit: canManage };
}

export function buildCreateEntityBody(
  form: EntityCreateForm
): { ok: true; body: EntityCreateBody } | { ok: false; error: string } {
  const cnpj = form.cnpj.trim();
  const legalName = form.legalName.trim();
  if (!cnpj || !legalName) {
    return { ok: false, error: "Informe CNPJ e razão social." };
  }
  return {
    ok: true,
    body: {
      cnpj,
      legalName,
      tradeName: form.tradeName.trim() || null,
      state: form.state.trim().toUpperCase() || null,
      city: form.city.trim() || null,
    },
  };
}

export function buildUpdateEntityBody(form: EntityEditForm): EntityUpdateBody {
  return {
    legalName: form.legalName.trim(),
    tradeName: form.tradeName.trim() || null,
    state: form.state.trim().toUpperCase() || null,
    city: form.city.trim() || null,
    active: form.active,
    monitorDomicilio: form.monitorDomicilio,
    monitorDatajud: form.monitorDatajud,
    monitorDjen: form.monitorDjen,
    monitorCertificates: form.monitorCertificates,
  };
}

export function exposureEntityErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Não foi possível salvar a empresa.";
}

export function exposureEntityRequest(mode: "create" | "edit", id?: string): { method: "POST" | "PATCH"; path: string } {
  if (mode === "create") return { method: "POST", path: ENTITY_COLLECTION };
  return { method: "PATCH", path: `${ENTITY_COLLECTION}/${id}` };
}
