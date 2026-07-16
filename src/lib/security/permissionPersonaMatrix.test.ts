/**
 * Matriz oficial de personas — RC Prompt 16.
 * Cobre expectativas de navegação (view) e negações críticas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessModule } from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import {
  canAccessPath,
  canViewModule,
  canViewResource,
  evaluatePathViewAccess,
} from "@/src/lib/resourceNavigationAccess.js";
import {
  buildPersonaContext,
  PERMISSION_PERSONA_MATRIX,
} from "@/src/lib/security/permissionPersonaMatrix.js";

describe("permissionPersonaMatrix — navegação por persona", () => {
  for (const persona of PERMISSION_PERSONA_MATRIX) {
    it(`${persona.id}: view/deny módulos alinhados`, () => {
      const c = buildPersonaContext(persona);
      for (const mod of persona.expectViewModules) {
        assert.equal(
          canViewModule(mod, c),
          true,
          `${persona.id} deveria ver ${mod}`
        );
      }
      for (const mod of persona.expectDenyModules) {
        assert.equal(
          canViewModule(mod, c),
          false,
          `${persona.id} não deveria ver ${mod}`
        );
      }
      for (const path of persona.expectDenyPaths ?? []) {
        assert.equal(canAccessPath(path, c), false, `${persona.id} path ${path}`);
        assert.equal(evaluatePathViewAccess(path, c).allowed, false);
      }
    });
  }

  it("SUPER_ADMIN: canViewResource irrestrito", () => {
    const c = buildPersonaContext(PERMISSION_PERSONA_MATRIX[0]!);
    assert.equal(canViewResource(c.user, ResourceKeys.FINANCEIRO), true);
    assert.equal(canViewResource(c.user, ResourceKeys.ADMIN_USUARIOS), true);
  });

  it("legado: opex via DTO efetivo (P10)", () => {
    const persona = PERMISSION_PERSONA_MATRIX.find(
      (p) => p.id === "legado_sem_grants_estruturados"
    )!;
    const c = buildPersonaContext(persona);
    assert.equal(evaluatePathViewAccess("/opex", c).source, "effective_dto");
    assert.equal(canAccessModule("opex", c.checker), true);
    assert.equal(canViewModule("opex", c), true);
  });

  it("parent negado: bag sem finance.view não abre /finance", () => {
    const c = buildPersonaContext(
      PERMISSION_PERSONA_MATRIX.find((p) => p.id === "usuario_com_deny")!
    );
    assert.equal(canViewModule("finance", c), false);
    assert.equal(canAccessPath("/finance", c), false);
  });
});
