/**
 * Helpers puros — vínculo de Pessoa Canônica no formulário de colaborador.
 * Não sobrescreve silenciosamente nome / nome social / e-mails / CPF / telefone.
 */

import {
  detectPersonFieldConflicts,
  type FieldConflict,
  type PersonFieldKey,
  type PersonIdentitySnapshot,
} from "@/src/lib/canonicalPerson.js";

export type EmployeePersonFormSlice = {
  name: string;
  socialName?: string | null;
  corporateEmail?: string | null;
  personalEmail?: string | null;
  cpf?: string | null;
  phone?: string | null;
};

export type CompatiblePersonFill = {
  /** Campos vazios no formulário que podem receber valor da pessoa. */
  fillable: Partial<EmployeePersonFormSlice>;
  conflicts: FieldConflict[];
};

export const PERSON_FIELD_LABELS: Record<PersonFieldKey, string> = {
  displayName: "Nome",
  socialName: "Nome social",
  corporateEmail: "E-mail corporativo",
  personalEmail: "E-mail pessoal",
  cpfNormalized: "CPF",
  phoneNormalized: "Telefone",
};

function empty(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

export function formSliceToPersonSnapshot(
  form: EmployeePersonFormSlice
): PersonIdentitySnapshot {
  return {
    displayName: form.name?.trim() || null,
    socialName: form.socialName?.trim() || null,
    corporateEmail: form.corporateEmail?.trim() || null,
    personalEmail: form.personalEmail?.trim() || null,
    cpfNormalized: form.cpf?.trim() || null,
    phoneNormalized: form.phone?.trim() || null,
  };
}

/**
 * Propõe preenchimento: só campos vazios; conflitos ficam separados (exigem escolha).
 */
export function proposeCompatiblePersonFill(
  form: EmployeePersonFormSlice,
  person: PersonIdentitySnapshot
): CompatiblePersonFill {
  const formSnap = formSliceToPersonSnapshot(form);
  const conflicts = detectPersonFieldConflicts(formSnap, person);
  const fillable: Partial<EmployeePersonFormSlice> = {};

  if (empty(form.name) && person.displayName?.trim()) {
    fillable.name = person.displayName.trim();
  }
  if (empty(form.socialName) && person.socialName?.trim()) {
    fillable.socialName = person.socialName.trim();
  }
  if (empty(form.corporateEmail) && person.corporateEmail?.trim()) {
    fillable.corporateEmail = person.corporateEmail.trim();
  }
  if (empty(form.personalEmail) && person.personalEmail?.trim()) {
    fillable.personalEmail = person.personalEmail.trim();
  }
  if (empty(form.cpf) && person.cpfNormalized?.trim()) {
    fillable.cpf = person.cpfNormalized.trim();
  }
  if (empty(form.phone) && person.phoneNormalized?.trim()) {
    fillable.phone = person.phoneNormalized.trim();
  }

  return { fillable, conflicts };
}

/** Aplica só o patch fillable (nunca conflito). */
export function applyCompatibleFill(
  form: EmployeePersonFormSlice,
  fillable: Partial<EmployeePersonFormSlice>
): EmployeePersonFormSlice {
  return {
    ...form,
    ...(fillable.name != null ? { name: fillable.name } : {}),
    ...(fillable.socialName != null ? { socialName: fillable.socialName } : {}),
    ...(fillable.corporateEmail != null
      ? { corporateEmail: fillable.corporateEmail }
      : {}),
    ...(fillable.personalEmail != null ? { personalEmail: fillable.personalEmail } : {}),
    ...(fillable.cpf != null ? { cpf: fillable.cpf } : {}),
    ...(fillable.phone != null ? { phone: fillable.phone } : {}),
  };
}

/** Ao escolher "usar da pessoa" em um conflito, espelha o valor no formulário. */
export function applyPersonConflictChoice(
  form: EmployeePersonFormSlice,
  field: PersonFieldKey,
  personValue: string | null
): EmployeePersonFormSlice {
  const v = personValue?.trim() || "";
  switch (field) {
    case "displayName":
      return { ...form, name: v };
    case "socialName":
      return { ...form, socialName: v };
    case "corporateEmail":
      return { ...form, corporateEmail: v };
    case "personalEmail":
      return { ...form, personalEmail: v };
    case "cpfNormalized":
      return { ...form, cpf: v };
    case "phoneNormalized":
      return { ...form, phone: v };
    default:
      return form;
  }
}

export type PersonLinkSelection = {
  personId: string | null;
  personSourceKind: string | null;
  personSourceId: string | null;
  createNewPerson: boolean;
};

export function selectionFromResolveHit(hit: {
  personId: string | null;
  sourceKind: string;
  sourceEntityId: string;
}): PersonLinkSelection {
  if (hit.personId) {
    return {
      personId: hit.personId,
      personSourceKind: null,
      personSourceId: null,
      createNewPerson: false,
    };
  }
  return {
    personId: null,
    personSourceKind: hit.sourceKind,
    personSourceId: hit.sourceEntityId,
    createNewPerson: false,
  };
}

export function createNewPersonSelection(): PersonLinkSelection {
  return {
    personId: null,
    personSourceKind: null,
    personSourceId: null,
    createNewPerson: true,
  };
}

export function clearPersonSelection(opts?: {
  /** Em edição sem personId: não forçar criar nova automaticamente. */
  keepWithoutPerson?: boolean;
}): PersonLinkSelection {
  return {
    personId: null,
    personSourceKind: null,
    personSourceId: null,
    createNewPerson: opts?.keepWithoutPerson ? false : true,
  };
}

export function encodePersonSelectionValue(sel: PersonLinkSelection): string {
  if (sel.personId) return `person:${sel.personId}`;
  if (sel.personSourceKind && sel.personSourceId) {
    return `${sel.personSourceKind}:${sel.personSourceId}`;
  }
  return "";
}

export function hasActivePersonLink(sel: PersonLinkSelection): boolean {
  return Boolean(sel.personId || (sel.personSourceKind && sel.personSourceId));
}
