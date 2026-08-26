/**
 * Capabilities da ficha funcional a partir do motor oficial (bag de permissões).
 * employees.view NUNCA libera valores monetários.
 * employees.edit continua alias amplo legado (compatibilidade), inclusive sensitive_data.
 */

import type { EmployeePermissionBag } from "./employeesPermissions.js";
import {
  canUpdateEmployees,
  canViewEmployeeAdministrativeData,
  canViewEmployeePersonalData,
  canViewEmployeeSensitiveData,
  canManageEmployeeEpi,
} from "./employeesPermissions.js";
import type { PeopleAccessScope, PeopleProfileCapabilities } from "./peopleProfileTypes.js";

function hasAny(check: EmployeePermissionBag, keys: readonly string[]): boolean {
  if (typeof check.hasAnyPermission === "function") {
    return check.hasAnyPermission(keys);
  }
  return keys.some((k) => check.hasPermission(k));
}

function isExplicitlyDenied(check: EmployeePermissionBag, keys: readonly string[]): boolean {
  if (typeof check.isDenied !== "function") return false;
  return keys.some((k) => check.isDenied!(k));
}

function canonicalView(check: EmployeePermissionBag, resourceKey: string): boolean | null {
  if (!check.canonicalViewResources) return null;
  return check.canonicalViewResources.includes(resourceKey);
}

/** Chaves finas + aliases. employees.view não entra em values. */
export const PEOPLE_PROFILE_PERMISSIONS = {
  profileView: ["employees.profile.view", "employees.view", "employees.edit"] as const,
  professionalView: [
    "employees.professional.view",
    "employees.profile.view",
    "employees.view",
    "employees.edit",
  ] as const,
  professionalManage: ["employees.professional.manage", "employees.edit"] as const,
  careerView: ["employees.career.view", "employees.view", "employees.edit"] as const,
  careerManage: ["employees.career.manage", "employees.edit"] as const,
  compensationEventsView: [
    "employees.compensation.events.view",
    "employees.view",
    "employees.edit",
    "employees.sensitive_data.view",
  ] as const,
  compensationValuesView: [
    "employees.compensation.values.view",
    "employees.sensitive_data.view",
    "employees.edit",
  ] as const,
  compensationManage: ["employees.compensation.manage", "employees.edit"] as const,
  benefitsView: ["employees.benefits.view", "employees.view", "employees.edit"] as const,
  benefitsManage: ["employees.benefits.manage", "employees.edit"] as const,
  personalView: [
    "employees.personal.view",
    "employees.personal_data.view",
    "people.pii.view",
    "employees.edit",
  ] as const,
  personalManage: ["employees.personal.manage", "employees.edit"] as const,
  emergencyView: [
    "employees.emergency.view",
    "employees.sensitive_data.view",
    "employees.edit",
  ] as const,
  emergencyManage: ["employees.emergency.manage", "employees.edit"] as const,
  epiView: ["employees.epi.view", "employees.view", "employees.edit", "employees.epi.manage"] as const,
  epiManage: ["employees.epi.manage", "employees.edit"] as const,
  documentsView: ["employees.documents.view", "employees.view", "employees.edit"] as const,
  documentsManage: ["employees.documents.manage", "employees.edit"] as const,
  absencesView: ["employees.absences.view", "employees.view", "employees.edit"] as const,
  absencesManage: ["employees.absences.manage", "employees.edit"] as const,
  historyView: ["employees.history.view", "employees.view", "employees.edit"] as const,
  notesView: ["employees.notes.view", "employees.view", "employees.edit"] as const,
  notesManage: ["employees.notes.manage", "employees.edit"] as const,
  notesRestrictedView: [
    "employees.notes.restricted.view",
    "employees.administrative_data.view",
    "employees.edit",
  ] as const,
  auditView: ["employees.audit.view", "employees.edit"] as const,
  teamDirect: ["employees.team.view"] as const,
  teamDescendants: ["employees.team.descendants.view"] as const,
} as const;

export function resolvePeopleAccessScope(check: EmployeePermissionBag): PeopleAccessScope {
  // RH legado: employees.view/edit enxergam todos. Não usar profile.view como ALL.
  if (check.hasPermission("employees.view") || check.hasPermission("employees.edit")) {
    return "ALL";
  }
  if (hasAny(check, PEOPLE_PROFILE_PERMISSIONS.teamDescendants)) return "DESCENDANTS";
  if (hasAny(check, PEOPLE_PROFILE_PERMISSIONS.teamDirect)) return "DIRECT_REPORTS";
  if (hasAny(check, PEOPLE_PROFILE_PERMISSIONS.profileView)) return "SELF";
  return "NONE";
}

export function canViewPeopleProfile(check: EmployeePermissionBag): boolean {
  return (
    hasAny(check, PEOPLE_PROFILE_PERMISSIONS.profileView) ||
    hasAny(check, PEOPLE_PROFILE_PERMISSIONS.teamDirect) ||
    hasAny(check, PEOPLE_PROFILE_PERMISSIONS.teamDescendants)
  );
}

export function canViewCompensationValues(check: EmployeePermissionBag): boolean {
  if (isExplicitlyDenied(check, PEOPLE_PROFILE_PERMISSIONS.compensationValuesView)) {
    return false;
  }
  const canonical = canonicalView(check, "admin.employees.compensation_values");
  if (canonical === false) return false;
  if (canonical === true) return true;
  return hasAny(check, PEOPLE_PROFILE_PERMISSIONS.compensationValuesView);
}

export function canViewCompensationEvents(check: EmployeePermissionBag): boolean {
  return hasAny(check, PEOPLE_PROFILE_PERMISSIONS.compensationEventsView);
}

export function canManageCompensation(check: EmployeePermissionBag): boolean {
  return (
    hasAny(check, PEOPLE_PROFILE_PERMISSIONS.compensationManage) &&
    canViewCompensationValues(check)
  );
}

export function buildPeopleProfileCapabilities(
  check: EmployeePermissionBag,
  opts?: { selfRecord?: boolean }
): PeopleProfileCapabilities {
  const scope = resolvePeopleAccessScope(check);
  const selfRecord = opts?.selfRecord === true;
  const accessScope: PeopleAccessScope =
    scope === "NONE" && selfRecord ? "SELF" : scope;

  const canView =
    canViewPeopleProfile(check) || (selfRecord && accessScope === "SELF");

  return {
    canViewProfile: canView,
    canViewOverview: canView,
    canViewProfessional: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.professionalView) || canView,
    canManageProfessional: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.professionalManage),
    canViewCareer: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.careerView) || canView,
    canManageCareer: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.careerManage),
    canViewCompensationEvents: canViewCompensationEvents(check) || canView,
    canViewCompensationValues: canViewCompensationValues(check),
    canManageCompensation: canManageCompensation(check),
    canViewBenefits: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.benefitsView) || canView,
    canManageBenefits: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.benefitsManage),
    canViewPersonal: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.personalView) || canViewEmployeePersonalData(check),
    canManagePersonal: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.personalManage),
    canViewEmergency:
      hasAny(check, PEOPLE_PROFILE_PERMISSIONS.emergencyView) ||
      canViewEmployeeSensitiveData(check),
    canManageEmergency: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.emergencyManage),
    canViewEpi: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.epiView) || canView,
    canManageEpi: canManageEmployeeEpi(check),
    canViewDocuments: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.documentsView) || canView,
    canManageDocuments: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.documentsManage),
    canViewAbsences: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.absencesView) || canView,
    canManageAbsences: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.absencesManage),
    canViewHistory: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.historyView) || canView,
    canViewNotes: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.notesView) || canView,
    canManageNotes: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.notesManage) || canUpdateEmployees(check),
    canViewRestrictedNotes:
      hasAny(check, PEOPLE_PROFILE_PERMISSIONS.notesRestrictedView) ||
      canViewEmployeeAdministrativeData(check),
    canViewAudit: hasAny(check, PEOPLE_PROFILE_PERMISSIONS.auditView),
    accessScope,
  };
}
