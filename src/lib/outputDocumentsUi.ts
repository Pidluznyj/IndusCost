/**
 * Helpers browser-safe da tela Comercial → Documentos de Saída.
 */
import { COMMERCIAL_ACTIONS, COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";

export const OUTPUT_DOCUMENTS_MODULE_ID = "output-documents" as const;
export const OUTPUT_DOCUMENTS_ROUTE_PATH = "/output-documents";
export const OUTPUT_DOCUMENTS_PAGE_TITLE = "Documentos de Saída";
export const OUTPUT_DOCUMENTS_PAGE_SUBTITLE =
  "Consulta read-only dos documentos sincronizados do Nomus.";
export const OUTPUT_DOCUMENTS_BREADCRUMB = "Comercial / Documentos de Saída";
export const OUTPUT_DOCUMENTS_VIEW_LEGACY_PERMISSION =
  "output_documents.view" as const;

export function canViewOutputDocuments(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  return Boolean(
    check.canPerformAction?.(
      COMMERCIAL_RESOURCE_KEYS.outputDocuments,
      COMMERCIAL_ACTIONS.view
    ) || check.hasPermission?.(OUTPUT_DOCUMENTS_VIEW_LEGACY_PERMISSION)
  );
}

export function canAccessOutputDocumentsModule(
  check: PermissionChecker
): boolean {
  return check.hasPermission(OUTPUT_DOCUMENTS_VIEW_LEGACY_PERMISSION);
}

export function isOutputDocumentsDateRangeInvalid(
  from: string,
  to: string
): boolean {
  return Boolean(from && to && from > to);
}

export function hasActiveOutputDocumentsFilters(input: {
  search: string;
  company: string;
  customer: string;
  from: string;
  to: string;
}): boolean {
  return Boolean(
    input.search.trim() ||
      input.company.trim() ||
      input.customer.trim() ||
      input.from ||
      input.to
  );
}

export function classifyOutputDocumentsListError(error: unknown): {
  kind: "access_denied" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para consultar Documentos de Saída.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message:
          "API de Documentos de Saída indisponível. Tente novamente em instantes.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar Documentos de Saída.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message:
        "API de Documentos de Saída indisponível. Tente novamente em instantes.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao carregar Documentos de Saída.",
  };
}
