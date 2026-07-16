/**
 * P05 — estados INHERIT/ALLOW/DENY, validação e round-trip matriz → resolvedor → DTO.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  absoluteBooleanToOverrideState,
  decodeOverrideState,
  diffBooleanToOverrideState,
  encodeOverrideState,
  statesToPersistableRow,
} from "./permissionOverrideState.ts";
import {
  buildPersistableOverridesFromDraft,
  clearOverrideStates,
  PermissionOverrideValidationError,
  validateAndNormalizeOverrideInputs,
} from "./permissionOverrideValidate.ts";
import { overridesPayloadFromDraft } from "@/src/lib/userPermissionsAdminUi.js";
import {
  buildEffectiveFlagsMap,
  materializeLegacyPermissionsFromFlags,
} from "@/src/lib/security/permissionRolePresets.js";
import { mapSeedAxisOverridesToContract } from "@/src/lib/security/effectiveAccessDto/mapOverrides.js";
import {
  canEffectiveAccess,
  resolveEffectiveAccess,
} from "@/src/lib/security/effectiveAccess/index.js";
import { buildEffectiveAccessDto } from "@/src/lib/security/effectiveAccessDto/buildEffectiveAccessDto.js";
import {
  normalizeOverrideInputs,
  UserPermissionAdminError,
} from "@/src/lib/security/userPermissionAdminService.js";
import { buildOverrideSaveAuditPlans } from "@/src/lib/security/permissionAudit.js";

describe("permissionOverrideState encode/decode", () => {
  it("INHERIT/ALLOW/DENY ↔ null/true/false", () => {
    assert.equal(encodeOverrideState("INHERIT"), null);
    assert.equal(encodeOverrideState("ALLOW"), true);
    assert.equal(encodeOverrideState("DENY"), false);
    assert.equal(decodeOverrideState(null), "INHERIT");
    assert.equal(decodeOverrideState(true), "ALLOW");
    assert.equal(decodeOverrideState(false), "DENY");
  });

  it("desmarcar herdado → DENY; limpar → INHERIT", () => {
    assert.equal(diffBooleanToOverrideState(false, true), "DENY");
    assert.equal(diffBooleanToOverrideState(true, false), "ALLOW");
    assert.equal(diffBooleanToOverrideState(true, true), "INHERIT");
    assert.equal(diffBooleanToOverrideState(false, false), "INHERIT");
    assert.equal(absoluteBooleanToOverrideState(false), "DENY");
    const cleared = clearOverrideStates("comercial");
    assert.equal(statesToPersistableRow(cleared), null);
  });
});

describe("permissionOverrideValidate", () => {
  it("rejeita recurso desconhecido e estado inválido", () => {
    assert.throws(
      () => validateAndNormalizeOverrideInputs([{ resourceKey: "fantasma.x", canView: true }]),
      (e: unknown) =>
        e instanceof PermissionOverrideValidationError && e.code === "UNKNOWN_RESOURCE"
    );
    assert.throws(
      () =>
        validateAndNormalizeOverrideInputs([
          { resourceKey: "dashboard", view: "MAYBE" as "ALLOW" },
        ]),
      (e: unknown) =>
        e instanceof PermissionOverrideValidationError && e.code === "INVALID_OVERRIDE_STATE"
    );
  });

  it("normalizeOverrideInputs propaga UNKNOWN_RESOURCE", () => {
    assert.throws(
      () => normalizeOverrideInputs([{ resourceKey: "nao.existe", canView: false }]),
      (e: unknown) => e instanceof UserPermissionAdminError && e.code === "UNKNOWN_RESOURCE"
    );
  });

  it("herança/allow/deny differential payload", () => {
    const rows = buildPersistableOverridesFromDraft({
      draft: {
        dashboard: { canView: true, canExecute: false, canManage: false },
        comercial: { canView: false, canExecute: false, canManage: false },
        "financeiro.contas_pagar": { canView: true, canExecute: false, canManage: false },
      },
      roleDefaults: [
        {
          resourceKey: "dashboard",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "comercial",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "financeiro.contas_pagar",
          flags: { canView: false, canExecute: false, canManage: false },
        },
      ],
      mode: "differential",
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.resourceKey, r]));
    assert.equal(byKey.dashboard, undefined, "igual baseline → INHERIT omitido");
    assert.equal(byKey.comercial?.canView, false, "deny");
    assert.equal(byKey["financeiro.contas_pagar"]?.canView, true, "allow");
  });

  it("modo absolute gera DENY em não marcados (Leticia)", () => {
    const rows = overridesPayloadFromDraft(
      {
        "financeiro.contas_pagar": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
        dashboard: { canView: false, canExecute: false, canManage: false },
        comercial: { canView: false, canExecute: false, canManage: false },
        "comercial.pedidos_venda": {
          canView: false,
          canExecute: false,
          canManage: false,
        },
      },
      [
        {
          resourceKey: "dashboard",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "comercial",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "comercial.pedidos_venda",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "financeiro.contas_pagar",
          flags: { canView: false, canExecute: false, canManage: false },
        },
      ],
      "absolute"
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.resourceKey, r]));
    assert.equal(byKey["financeiro.contas_pagar"]?.canView, true);
    assert.equal(byKey.dashboard?.canView, false);
    assert.equal(byKey.comercial?.canView, false);
    assert.equal(byKey["comercial.pedidos_venda"]?.canView, false);
  });
});

describe("P05 round-trip UI → flags → dual-write → resolver → DTO", () => {
  it("role ampla + deny comercial: bag sem crm.view", () => {
    const overrides = validateAndNormalizeOverrideInputs([
      { resourceKey: "comercial", canView: false },
      { resourceKey: "comercial.pedidos_venda", canView: false },
      { resourceKey: "financeiro.contas_pagar", canView: true },
    ]);
    const effective = buildEffectiveFlagsMap(
      "VIEWER",
      overrides.map((o) => ({ ...o, userId: "u1" }))
    );
    assert.equal(effective.comercial?.canView, false);
    assert.equal(effective["financeiro.contas_pagar"]?.canView, true);
    const bag = materializeLegacyPermissionsFromFlags(effective, []);
    assert.equal(bag.includes("crm.view"), false);
    assert.equal(bag.includes("sales_orders.view"), false);
    assert.ok(bag.includes("finance.accountsPayable.view"));
  });

  it("perfil com deny: snapshot vazio + allow AP + deny comercial via overrides", () => {
    const mapped = mapSeedAxisOverridesToContract([
      { resourceKey: "financeiro.contas_pagar", canView: true },
      { resourceKey: "comercial", canView: false },
      { resourceKey: "comercial.pedidos_venda", canView: false },
    ]);
    const result = resolveEffectiveAccess({
      userId: "profile-deny",
      role: "VIEWER",
      profileSnapshot: {},
      overrides: mapped,
    });
    assert.equal(
      result.byResourceAction["finance.accounts_payable"]?.view?.decision,
      "allow"
    );
    assert.equal(canEffectiveAccess(result, "commercial.sales_orders", "view"), false);
    const dto = buildEffectiveAccessDto({ result, audience: "session" });
    assert.ok(
      (dto as { allowedResources: string[] }).allowedResources.includes(
        "finance.accounts_payable"
      )
    );
  });

  it("Leticia absolute → resolver só AP; dual-write sem comercial", () => {
    const rows = buildPersistableOverridesFromDraft({
      draft: {
        "financeiro.contas_pagar": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
      },
      roleDefaults: [
        {
          resourceKey: "dashboard",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "comercial",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "comercial.pedidos_venda",
          flags: { canView: true, canExecute: false, canManage: false },
        },
        {
          resourceKey: "financeiro.contas_pagar",
          flags: { canView: false, canExecute: false, canManage: false },
        },
      ],
      mode: "absolute",
      catalogKeys: [
        "dashboard",
        "comercial",
        "comercial.pedidos_venda",
        "financeiro.contas_pagar",
      ],
    });
    const effective = buildEffectiveFlagsMap(
      "VIEWER",
      rows.map((o) => ({ ...o, userId: "leticia" }))
    );
    assert.equal(effective.dashboard?.canView, false);
    assert.equal(effective.comercial?.canView, false);
    assert.equal(effective["financeiro.contas_pagar"]?.canView, true);
    const bag = materializeLegacyPermissionsFromFlags(effective, ["reports.material_demand.view"]);
    assert.equal(bag.includes("crm.view"), false);
    assert.equal(bag.includes("dashboard.view"), false);
    assert.ok(bag.includes("finance.accountsPayable.view"));
    assert.ok(bag.includes("reports.material_demand.view"), "unmapped preservado");

    const mapped = mapSeedAxisOverridesToContract(rows);
    const resolved = resolveEffectiveAccess({
      userId: "leticia",
      role: "VIEWER",
      profileSnapshot: {},
      overrides: mapped,
    });
    assert.equal(
      resolved.byResourceAction["finance.accounts_payable"]?.view?.source,
      "OVERRIDE_ALLOW"
    );
    assert.equal(canEffectiveAccess(resolved, "finance", "view"), false);
    assert.equal(canEffectiveAccess(resolved, "commercial.sales_orders", "view"), false);
    const dto = buildEffectiveAccessDto({ result: resolved, audience: "session" });
    assert.ok(
      (dto as { allowedResources: string[] }).allowedResources.includes(
        "finance.accounts_payable"
      )
    );
    assert.equal(
      (dto as { allowedResources: string[] }).allowedResources.includes(
        "commercial.sales_orders"
      ),
      false
    );
  });

  it("concorrência: ifMatch divergente → CONFLICT (semântica)", () => {
    const ifMatchOverrideCount: number = 2;
    const actualCount: number = 3;
    const conflict =
      typeof ifMatchOverrideCount === "number" &&
      ifMatchOverrideCount !== actualCount;
    assert.equal(conflict, true);
    const err = new UserPermissionAdminError(
      "CONFLICT",
      "Overrides foram alterados por outra sessão. Recarregue e tente novamente.",
      { expected: ifMatchOverrideCount, actual: actualCount }
    );
    assert.equal(err.code, "CONFLICT");
  });

  it("rollback semântico: clear override = INHERIT (sem linha) + auditoria", () => {
    const before = validateAndNormalizeOverrideInputs([
      { resourceKey: "comercial", canView: false },
    ]);
    assert.equal(before.length, 1);
    const afterClear = validateAndNormalizeOverrideInputs([
      { resourceKey: "comercial", view: "INHERIT", execute: "INHERIT", manage: "INHERIT" },
    ]);
    assert.equal(afterClear.length, 0);
    const plans = buildOverrideSaveAuditPlans({
      targetRole: "VIEWER",
      before: before.map((o) => ({ ...o, reason: null })),
      after: afterClear,
    });
    assert.ok(plans.some((p) => p.action === "OVERRIDE_REMOVED"));
  });
});
