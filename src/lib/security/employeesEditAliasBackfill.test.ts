import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bagNeedsEmployeesEdit,
  formatEmployeesEditBackfillPlan,
  overridesGrantEmployeesEdit,
  planEmployeesEditBackfill,
} from "./employeesEditAliasBackfill.ts";

describe("employeesEditAliasBackfill — planner", () => {
  it("bag com employees.create sem employees.edit precisa do alias; os demais não", () => {
    assert.equal(bagNeedsEmployeesEdit(["employees.view", "employees.create"]), true);
    assert.equal(
      bagNeedsEmployeesEdit(["employees.view", "employees.create", "employees.edit"]),
      false
    );
    assert.equal(bagNeedsEmployeesEdit(["employees.view"]), false);
    assert.equal(bagNeedsEmployeesEdit([]), false);
  });

  it("override Executar/Gerenciar em admin.employees conta; view só ou outro recurso não", () => {
    assert.equal(
      overridesGrantEmployeesEdit([{ resourceKey: "admin.employees", canExecute: true }]),
      true
    );
    assert.equal(
      overridesGrantEmployeesEdit([{ resourceKey: "admin.employees", canManage: true }]),
      true
    );
    assert.equal(
      overridesGrantEmployeesEdit([
        { resourceKey: "admin.employees", canExecute: false, canManage: null },
      ]),
      false
    );
    assert.equal(
      overridesGrantEmployeesEdit([{ resourceKey: "admin.employees.dashboard", canExecute: true }]),
      false
    );
    assert.equal(overridesGrantEmployeesEdit(undefined), false);
  });

  it("plano só acrescenta employees.edit, ordena, ignora SUPER_ADMIN e quem já tem a chave", () => {
    const plan = planEmployeesEditBackfill({
      profiles: [
        { id: "p1", name: "RH", permissions: ["employees.view", "employees.create"] },
        {
          id: "p2",
          name: "RH completo",
          permissions: ["employees.create", "employees.edit", "employees.view"],
        },
        { id: "p3", name: "Leitura", permissions: ["employees.view"] },
      ],
      users: [
        {
          id: "u1",
          email: "a@x.com",
          role: "USER",
          permissions: ["employees.create", "employees.view"],
        },
        {
          id: "u2",
          email: "b@x.com",
          role: "USER",
          permissions: ["employees.view"],
          overrides: [{ resourceKey: "admin.employees", canManage: true }],
        },
        { id: "u3", email: "root@x.com", role: "SUPER_ADMIN", permissions: [] },
        {
          id: "u4",
          email: "c@x.com",
          role: "USER",
          permissions: ["employees.edit", "employees.create"],
        },
        {
          id: "u5",
          email: "d@x.com",
          role: "USER",
          permissions: ["employees.view"],
          overrides: [{ resourceKey: "admin.employees", canExecute: null, canManage: false }],
        },
      ],
    });
    assert.deepEqual(
      plan.profiles.map((c) => c.id),
      ["p1"]
    );
    assert.deepEqual(plan.profiles[0].after, [
      "employees.create",
      "employees.edit",
      "employees.view",
    ]);
    assert.deepEqual(plan.profiles[0].before, ["employees.view", "employees.create"]);
    assert.deepEqual(
      plan.users.map((c) => [c.id, c.reason]),
      [
        ["u1", "legacy_create"],
        ["u2", "override_execute_or_manage"],
      ]
    );
    assert.deepEqual(plan.users[1].after, ["employees.edit", "employees.view"]);
    assert.deepEqual(plan.skipped, { profiles: 2, users: 2, superAdmins: 1 });
    // Nunca remove chave alguma.
    for (const c of [...plan.profiles, ...plan.users]) {
      for (const key of c.before) assert.ok(c.after.includes(key), `${c.id} perdeu ${key}`);
    }
    const text = formatEmployeesEditBackfillPlan(plan);
    assert.ok(text.includes('perfil "RH"'));
    assert.ok(text.includes("usuário b@x.com"));
  });
});
