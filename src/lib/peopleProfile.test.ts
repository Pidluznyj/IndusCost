import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  computeAdjustmentPercentage,
  computeTenureParts,
  formatTenureLabel,
  pickLastAdjustment,
  pickLastPromotion,
} from "./peopleProfileKpis.ts";
import {
  collectDescendantIds,
  wouldCreateManagerCycle,
  wouldCreateSelfManager,
  canAccessEmployeeRecord,
} from "./peopleProfileAccess.ts";
import { assertNoCompensationValuesLeak, omitMonetaryFields } from "./peopleProfileSanitize.ts";
import { buildPeopleProfileCapabilities } from "./peopleProfileCapabilities.ts";
import {
  buildHistoryKeysetWhere,
  compareHistoryDesc,
  diffEmployeeSnapshots,
  paginateHistory,
  toHistoryEventDto,
} from "./peopleProfileHistory.ts";
import {
  mapPayrollComponentToHrCatalogItem,
  officialPayrollBenefitCode,
  overlayOfficialPayrollName,
  payrollIdFromHrBenefitCode,
  payrollTypeLabel,
} from "./peopleOfficialPayrollCatalog.ts";

function check(perms: string[]) {
  const set = new Set(perms);
  return {
    hasPermission: (p: string) => set.has(p),
    hasAnyPermission: (list: readonly string[]) => list.some((p) => set.has(p)),
  };
}

describe("peopleProfileKpis", () => {
  it("calcula tempo de casa em anos e meses", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    assert.equal(formatTenureLabel("2019-08-14", now), "7 anos");
    assert.equal(formatTenureLabel("2019-06-14", now), "7 anos e 2 meses");
    assert.equal(formatTenureLabel(null, now), null);
    const parts = computeTenureParts("2026-08-01", now);
    assert.equal(parts?.years, 0);
    assert.equal(parts?.months, 0);
  });

  it("percentual de reajuste e última promoção", () => {
    assert.equal(computeAdjustmentPercentage(1000, 1068), 6.8);
    assert.equal(computeAdjustmentPercentage(0, 100), null);
    const promo = pickLastPromotion([
      { eventType: "ROLE_CHANGE", effectiveDate: "2024-01-01", newRoleName: "A" },
      { eventType: "PROMOTION", effectiveDate: "2021-03-01", previousRoleName: "I", newRoleName: "II" },
      { eventType: "PROMOTION", effectiveDate: "2025-02-03", previousRoleName: "II", newRoleName: "III" },
    ]);
    assert.equal(promo?.newRoleName, "III");
    const adj = pickLastAdjustment([
      { effectiveDate: "2024-01-01", percentage: 3 },
      { effectiveDate: "2026-05-01", percentage: 6.8 },
    ]);
    assert.equal(adj?.percentage, 6.8);
  });
});

describe("peopleProfileAccess — hierarquia e ciclo", () => {
  const links = [
    { id: "A", managerId: null },
    { id: "B", managerId: "A" },
    { id: "C", managerId: "B" },
  ];

  it("bloqueia A→A, A→B→A e A→B→C→A", () => {
    assert.equal(wouldCreateSelfManager("A", "A"), true);
    assert.equal(wouldCreateManagerCycle(links, "A", "A"), true);
    assert.equal(wouldCreateManagerCycle([{ id: "A", managerId: "B" }, { id: "B", managerId: "A" }], "A", "B"), true);
    assert.equal(wouldCreateManagerCycle(links, "A", "C"), true);
    assert.equal(wouldCreateManagerCycle(links, "C", "A"), false);
  });

  it("escopo ALL / DIRECT / DESCENDANTS / fora da árvore", () => {
    assert.equal(
      canAccessEmployeeRecord({
        scope: "ALL",
        actorEmployeeId: "Z",
        targetEmployeeId: "C",
        targetManagerId: "B",
      }),
      true
    );
    assert.equal(
      canAccessEmployeeRecord({
        scope: "DIRECT_REPORTS",
        actorEmployeeId: "A",
        targetEmployeeId: "B",
        targetManagerId: "A",
      }),
      true
    );
    assert.equal(
      canAccessEmployeeRecord({
        scope: "DIRECT_REPORTS",
        actorEmployeeId: "A",
        targetEmployeeId: "C",
        targetManagerId: "B",
      }),
      false
    );
    const descendants = new Set(collectDescendantIds(links, "A"));
    assert.deepEqual([...descendants].sort(), ["B", "C"]);
    assert.equal(
      canAccessEmployeeRecord({
        scope: "DESCENDANTS",
        actorEmployeeId: "A",
        targetEmployeeId: "C",
        targetManagerId: "B",
        descendantIds: descendants,
      }),
      true
    );
    assert.equal(
      canAccessEmployeeRecord({
        scope: "DESCENDANTS",
        actorEmployeeId: "A",
        targetEmployeeId: "Z",
        targetManagerId: null,
        descendantIds: descendants,
      }),
      false
    );
  });
});

describe("peopleProfileCapabilities — deny/financeiro", () => {
  it("employees.view não libera valores", () => {
    const caps = buildPeopleProfileCapabilities(check(["employees.view"]));
    assert.equal(caps.canViewProfile, true);
    assert.equal(caps.canViewCompensationEvents, true);
    assert.equal(caps.canViewCompensationValues, false);
    assert.equal(caps.accessScope, "ALL");
  });

  it("RH financeiro via sensitive_data ou compensation.values", () => {
    assert.equal(
      buildPeopleProfileCapabilities(check(["employees.view", "employees.sensitive_data.view"]))
        .canViewCompensationValues,
      true
    );
    assert.equal(
      buildPeopleProfileCapabilities(check(["employees.compensation.values.view"]))
        .canViewCompensationValues,
      true
    );
  });

  it("líder de equipe não vê todo mundo", () => {
    const caps = buildPeopleProfileCapabilities(check(["employees.team.view"]));
    assert.equal(caps.accessScope, "DIRECT_REPORTS");
    assert.equal(caps.canViewCompensationValues, false);
  });

  it("chave desconhecida não libera", () => {
    const caps = buildPeopleProfileCapabilities(check(["unknown.key"]));
    assert.equal(caps.canViewProfile, false);
    assert.equal(caps.canViewCompensationValues, false);
    assert.equal(caps.accessScope, "NONE");
  });

  it("registrar reajuste exige permissão de valores, não só manage", () => {
    const manageOnly = buildPeopleProfileCapabilities(check(["employees.compensation.manage"]));
    assert.equal(manageOnly.canManageCompensation, false);
    const withValues = buildPeopleProfileCapabilities(
      check(["employees.compensation.manage", "employees.compensation.values.view"])
    );
    assert.equal(withValues.canManageCompensation, true);
    assert.equal(withValues.canViewCompensationValues, true);
  });
});

describe("peopleProfileSanitize — JSON bruto sem salário", () => {
  it("omite campos monetários do DTO", () => {
    const sanitized = omitMonetaryFields({
      identity: { name: "João" },
      salary: 5000,
      items: [{ percentage: 6.8, previousAmount: 1000, newAmount: 1068, differenceAmount: 68 }],
    });
    const json = JSON.stringify(sanitized);
    assert.ok(!json.includes("salary"));
    assert.ok(!json.includes("previousAmount"));
    assert.ok(!json.includes("newAmount"));
    assert.ok(json.includes("percentage"));
    assert.doesNotThrow(() => assertNoCompensationValuesLeak(sanitized));
  });
});

describe("peopleProfileHistory", () => {
  it("ordena por effectiveDate DESC, createdAt DESC, id DESC", () => {
    const rows = [
      { id: "a", effectiveDate: "2024-01-01", createdAt: "2024-01-02" },
      { id: "b", effectiveDate: "2025-01-01", createdAt: "2025-01-01" },
      { id: "c", effectiveDate: "2025-01-01", createdAt: "2025-01-02" },
    ];
    const sorted = [...rows].sort(compareHistoryDesc);
    assert.equal(sorted[0].id, "c");
    assert.equal(sorted[1].id, "b");
    assert.equal(sorted[2].id, "a");
  });

  it("pagina 50 de um histórico grande sem perder ordem", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: String(i).padStart(3, "0"),
      effectiveDate: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
      createdAt: `2020-02-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    const page = paginateHistory(rows, { limit: 50 });
    assert.equal(page.items.length, 50);
    assert.ok(page.nextCursor);
    const page2 = paginateHistory(rows, { limit: 50, cursor: page.nextCursor });
    assert.equal(page2.items.length, 50);
    const ids = new Set([...page.items, ...page2.items].map((r) => r.id));
    assert.equal(ids.size, 100);
  });

  it("não inventa promoção no diff; salário vira COMPENSATION_ADJUSTMENT", () => {
    const events = diffEmployeeSnapshots(
      {
        roleId: "r1",
        roleName: "Op I",
        departmentId: "d1",
        department: "Montagem",
        costCenterId: "c1",
        costCenter: "CC1",
        managerId: "m1",
        managerName: "Ana",
        contractType: "CLT",
        workSchedule: null,
        status: "ACTIVE",
        salary: 1000,
        admissionDate: "2019-08-14",
        terminationDate: null,
      },
      {
        roleId: "r1",
        roleName: "Op I",
        departmentId: "d1",
        department: "Montagem",
        costCenterId: "c1",
        costCenter: "CC1",
        managerId: "m1",
        managerName: "Ana",
        contractType: "CLT",
        workSchedule: null,
        status: "ACTIVE",
        salary: 1068,
        admissionDate: "2019-08-14",
        terminationDate: null,
      }
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "COMPENSATION_ADJUSTMENT");
  });

  it("líder vê percentual e autorizado vê valores no DTO", () => {
    const leader = toHistoryEventDto(
      {
        id: "1",
        eventType: "COMPENSATION_ADJUSTMENT",
        effectiveDate: "2026-05-01",
        createdAt: "2026-05-02",
        source: "USER",
        percentage: 6.8,
        previousAmount: 1000,
        newAmount: 1068,
        differenceAmount: 68,
      },
      { includeAmounts: false }
    );
    assert.ok(leader.summary.includes("6,8"));
    assert.equal("previousAmount" in leader, false);
    const hr = toHistoryEventDto(
      {
        id: "1",
        eventType: "COMPENSATION_ADJUSTMENT",
        effectiveDate: "2026-05-01",
        createdAt: "2026-05-02",
        source: "USER",
        percentage: 6.8,
        previousAmount: 1000,
        newAmount: 1068,
        differenceAmount: 68,
      },
      { includeAmounts: true }
    );
    assert.equal(hr.previousAmount, 1000);
    assert.ok(JSON.stringify(leader).includes("6"));
    assert.doesNotThrow(() => assertNoCompensationValuesLeak(leader));
  });
});

describe("peopleProfileCapabilities — deny vence alias", () => {
  it("deny explícito de valores vence employees.edit", () => {
    const caps = buildPeopleProfileCapabilities({
      hasPermission: (p) => p === "employees.edit" || p === "employees.view",
      hasAnyPermission: (keys) => keys.some((k) => k === "employees.edit" || k === "employees.view"),
      isDenied: (p) => p === "employees.compensation.values.view",
    });
    assert.equal(caps.canViewProfile, true);
    assert.equal(caps.canViewCompensationValues, false);
  });

  it("canonicalAccess sem compensation_values bloqueia R$ mesmo com edit", () => {
    const caps = buildPeopleProfileCapabilities({
      hasPermission: (p) => p === "employees.edit",
      hasAnyPermission: (keys) => keys.includes("employees.edit"),
      canonicalViewResources: ["admin.employees"],
    });
    assert.equal(caps.canViewCompensationValues, false);
  });

  it("canonicalAccess com compensation_values libera R$", () => {
    const caps = buildPeopleProfileCapabilities({
      hasPermission: () => false,
      canonicalViewResources: ["admin.employees.compensation_values"],
    });
    assert.equal(caps.canViewCompensationValues, true);
  });
});

describe("peopleProfileHistory — keyset", () => {
  it("cursor aponta para registros anteriores na ordem DESC", () => {
    const where = buildHistoryKeysetWhere({
      id: "bbb",
      effectiveDate: "2026-05-01T00:00:00.000Z",
      createdAt: "2026-05-02T00:00:00.000Z",
    });
    assert.ok(where);
    assert.equal(where!.OR.length, 3);
  });
});

describe("peopleProfile — wiring de segurança da ficha", () => {
  it("download de documento usa fetch autenticado, não <a href>", () => {
    const src = readFileSync(new URL("../components/employee/profile/PeopleDocumentsTab.tsx", import.meta.url), "utf8");
    assert.ok(src.includes("downloadEmployeeDocument"));
    assert.ok(!src.includes("href={doc.downloadUrl}"));
  });

  it("slot admin da listagem não serializa R$ da GET /api/employees", () => {
    const src = readFileSync(new URL("../components/EmployeeModule.tsx", import.meta.url), "utf8");
    assert.ok(!src.includes("viewingEmployee.costs?.salary"));
    assert.ok(!src.includes("viewingEmployee.costs?.totalMonthlyCost"));
  });

  it("rotas da ficha aplicam no-store e gate do catálogo de benefícios", () => {
    const src = readFileSync(new URL("./peopleProfileRoutes.ts", import.meta.url), "utf8");
    const form = readFileSync(
      new URL("../components/employee/profile/PeopleProfileManageForms.tsx", import.meta.url),
      "utf8"
    );
    assert.ok(src.includes("function noStore"));
    assert.ok(src.includes("canViewBenefits"));
    assert.ok(!src.includes("max-age=300"));
    assert.ok(src.includes("canViewCompensationValues && body.amount"));
    assert.ok(src.includes("listOfficialPayrollHrCatalogItems"));
    assert.ok(!src.includes("hrBenefit.findMany"));
    assert.ok(form.includes("/api/hr/benefits"));
    assert.ok(form.includes("/api/employees/lookups/roles"));
    assert.ok(form.includes("Estrutura Operacional"));
  });

  it("não persiste remuneração em localStorage/sessionStorage", () => {
    const dialog = readFileSync(
      new URL("../components/employee/profile/PeopleEmployeeProfileDialog.tsx", import.meta.url),
      "utf8"
    );
    const client = readFileSync(
      new URL("../components/employee/profile/profileClient.ts", import.meta.url),
      "utf8"
    );
    assert.ok(!dialog.includes("localStorage"));
    assert.ok(!dialog.includes("sessionStorage"));
    assert.ok(!client.includes("localStorage"));
  });
});

describe("peopleOfficialPayrollCatalog", () => {
  it("mapeia a verba oficial com o nome idêntico e tipo da Estrutura Operacional", () => {
    const item = mapPayrollComponentToHrCatalogItem({
      id: "comp-fgts",
      name: "FGTS",
      type: "CHARGE",
      calculationType: "PERCENTAGE",
    });
    assert.equal(item.id, "comp-fgts");
    assert.equal(item.name, "FGTS");
    assert.equal(item.category, "CHARGE");
    assert.equal(item.typeLabel, "Encargo");
    assert.equal(item.isFinancial, false);
    assert.equal(item.code, officialPayrollBenefitCode("comp-fgts"));
    assert.equal(payrollIdFromHrBenefitCode(item.code), "comp-fgts");
    assert.equal(payrollTypeLabel("BENEFIT"), "Benefício");
    assert.equal(payrollTypeLabel("PROVISION"), "Provisão");
  });

  it("leitura da ficha usa o nome vigente do cadastro oficial", () => {
    const payrollById = new Map([
      [
        "comp-vr",
        {
          id: "comp-vr",
          name: "Vale Refeição",
          type: "BENEFIT",
          calculationType: "FIXED",
        },
      ],
    ]);
    const overlaid = overlayOfficialPayrollName({
      code: officialPayrollBenefitCode("comp-vr"),
      fallbackName: "Nome antigo",
      fallbackCategory: "OTHER",
      payrollById,
    });
    assert.equal(overlaid.name, "Vale Refeição");
    assert.equal(overlaid.category, "BENEFIT");
    assert.equal(overlaid.typeLabel, "Benefício");
  });
});
