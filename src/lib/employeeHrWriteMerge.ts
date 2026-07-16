/**
 * Campos profissionais resolvidos por prepareEmployeePersistedFields.
 * Não podem ser sobrescritos pelo spread do perfil RH (pessoal/EPI/notas).
 */
const PROFESSIONAL_PERSISTED_KEYS = [
  "admissionDate",
  "terminationDate",
  "contractType",
  "managerName",
  "managerId",
] as const;

/**
 * Remove chaves profissionais do objeto de perfil RH antes do spread no create/update,
 * evitando que `null`/`undefined` apaguem valores já resolvidos em `persisted`.
 */
export function stripProfessionalOverridesFromHrProfile<T extends Record<string, unknown>>(
  hrProfile: T
): Omit<T, (typeof PROFESSIONAL_PERSISTED_KEYS)[number]> {
  const out = { ...hrProfile };
  for (const key of PROFESSIONAL_PERSISTED_KEYS) {
    delete out[key];
  }
  return out;
}

/** Junta payload core + perfil RH sem apagar campos profissionais. */
export function mergeEmployeeWriteData<
  TCore extends Record<string, unknown>,
  THr extends Record<string, unknown>,
>(core: TCore, hrProfile: THr): TCore & Omit<THr, (typeof PROFESSIONAL_PERSISTED_KEYS)[number]> {
  return {
    ...core,
    ...stripProfessionalOverridesFromHrProfile(hrProfile),
  };
}
