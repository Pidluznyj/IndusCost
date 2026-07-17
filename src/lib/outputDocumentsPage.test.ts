import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGroupedNavigationStructure,
  getModulePath,
  MODULE_MENU_PERMISSION_KEYS,
} from "@/src/lib/navigationGroups.js";
import {
  canAccessModule,
  resolveModuleIdFromPath,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import { SIDEBAR_MODULE_CONTRACT_KEYS } from "@/src/lib/sidebarEffectiveAccess.js";
import {
  buildOutputDocumentsQueryString,
  OUTPUT_DOCUMENTS_LIST_API_PATH,
  OUTPUT_DOCUMENTS_SUMMARY_API_PATH,
} from "@/src/lib/outputDocumentsClient.js";
import {
  canAccessOutputDocumentsModule,
  canViewOutputDocuments,
  classifyOutputDocumentsListError,
  hasActiveOutputDocumentsFilters,
  isOutputDocumentsDateRangeInvalid,
  OUTPUT_DOCUMENTS_BREADCRUMB,
  OUTPUT_DOCUMENTS_PAGE_SUBTITLE,
  OUTPUT_DOCUMENTS_PAGE_TITLE,
  OUTPUT_DOCUMENTS_ROUTE_PATH,
} from "@/src/lib/outputDocumentsUi.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (permission) => set.has(permission),
    hasAnyPermission: (permissions) =>
      permissions.some((permission) => set.has(permission)),
  };
}

describe("output documents navigation", () => {
  it("registra a rota e o ModulePageShell", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="output-documents"/);
    assert.match(app, /OutputDocumentsModule/);
    assert.match(app, new RegExp(OUTPUT_DOCUMENTS_PAGE_TITLE));
    assert.match(app, new RegExp(OUTPUT_DOCUMENTS_PAGE_SUBTITLE));
  });

  it("inclui Documentos de Saída no grupo Comercial", () => {
    const comercial = buildGroupedNavigationStructure().groups.find(
      (group) => group.id === "comercial"
    );
    const item = comercial?.items.find(
      (candidate) => candidate.itemId === "output-documents"
    );
    assert.ok(item);
    assert.equal(item.path, OUTPUT_DOCUMENTS_ROUTE_PATH);
    assert.equal(item.label, OUTPUT_DOCUMENTS_PAGE_TITLE);
    assert.equal(item.resourceKey, ResourceKeys.COMERCIAL_DOCUMENTOS_SAIDA);
    assert.deepEqual(
      [...MODULE_MENU_PERMISSION_KEYS["output-documents"]],
      ["output_documents.view"]
    );
  });

  it("alinha rota, módulo e recursos de proteção", () => {
    assert.equal(getModulePath("output-documents"), OUTPUT_DOCUMENTS_ROUTE_PATH);
    assert.equal(
      resolveModuleIdFromPath(OUTPUT_DOCUMENTS_ROUTE_PATH),
      "output-documents"
    );
    assert.equal(
      resolveSidebarModuleResourceKey("output-documents"),
      ResourceKeys.COMERCIAL_DOCUMENTOS_SAIDA
    );
    assert.deepEqual(SIDEBAR_MODULE_CONTRACT_KEYS["output-documents"], [
      COMMERCIAL_RESOURCE_KEYS.outputDocuments,
    ]);
  });

  it("oculta o módulo sem permissão e libera com view", () => {
    assert.equal(canAccessModule("output-documents", checker([])), false);
    assert.equal(
      canAccessModule(
        "output-documents",
        checker(["output_documents.view"])
      ),
      true
    );
    assert.equal(canAccessOutputDocumentsModule(checker([])), false);
    assert.equal(
      canAccessOutputDocumentsModule(checker(["output_documents.view"])),
      true
    );
  });
});

describe("outputDocumentsUi", () => {
  it("protege pelo recurso canônico ou fallback legado", () => {
    assert.equal(
      canViewOutputDocuments({
        canPerformAction: (resource, action) =>
          resource === COMMERCIAL_RESOURCE_KEYS.outputDocuments &&
          action === "view",
      }),
      true
    );
    assert.equal(
      canViewOutputDocuments({
        canPerformAction: () => false,
        hasPermission: (permission) => permission === "output_documents.view",
      }),
      true
    );
    assert.equal(
      canViewOutputDocuments({ canPerformAction: () => false }),
      false
    );
  });

  it("classifica erros e valida filtros básicos", () => {
    assert.equal(
      classifyOutputDocumentsListError(new HttpError(403, "forbidden")).kind,
      "access_denied"
    );
    assert.equal(
      classifyOutputDocumentsListError(new HttpError(503, "down")).kind,
      "api_unavailable"
    );
    assert.equal(
      classifyOutputDocumentsListError(new TypeError("network")).kind,
      "api_unavailable"
    );
    assert.equal(
      isOutputDocumentsDateRangeInvalid("2026-07-18", "2026-07-17"),
      true
    );
    assert.equal(
      hasActiveOutputDocumentsFilters({
        search: "",
        company: "",
        customer: "Cliente",
        from: "",
        to: "",
      }),
      true
    );
  });
});

describe("outputDocumentsClient", () => {
  it("expõe paths locais e serializa filtros", () => {
    assert.equal(
      OUTPUT_DOCUMENTS_LIST_API_PATH,
      "/api/commercial/output-documents"
    );
    assert.equal(
      OUTPUT_DOCUMENTS_SUMMARY_API_PATH,
      "/api/commercial/output-documents/summary"
    );
    assert.equal(
      buildOutputDocumentsQueryString({
        page: 2,
        pageSize: 25,
        search: "  DOC 10 ",
        customer: "Cliente A",
        cancelled: "yes",
        hasReceivable: "no",
        sortBy: "dataDocumento",
        sortDir: "desc",
      }),
      "?page=2&pageSize=25&sortBy=dataDocumento&sortDir=desc&cancelled=yes&hasReceivable=no&search=DOC+10&customer=Cliente+A"
    );
  });

  it("não importa cliente Nomus no bundle", () => {
    const client = read("src/lib/outputDocumentsClient.ts");
    assert.doesNotMatch(client, /nomusClient|fetchNomus|NOMUS_API/);
  });
});

describe("output documents page states", () => {
  it("mantém breadcrumb e estados básicos no módulo", () => {
    const source = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(source, /OUTPUT_DOCUMENTS_BREADCRUMB/);
    assert.equal(OUTPUT_DOCUMENTS_BREADCRUMB, "Comercial / Documentos de Saída");
    for (const marker of [
      "output-documents-denied",
      "output-documents-loading",
      "output-documents-empty",
      "output-documents-empty-filters",
      "output-documents-api-unavailable",
      "output-documents-grid-shell",
      "output-documents-status-chips",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /AbortController/);
    assert.match(source, /SEARCH_DEBOUNCE_MS/);
    assert.doesNotMatch(source, /<table/);
    assert.doesNotMatch(source, /<Overlay/);
  });
});
