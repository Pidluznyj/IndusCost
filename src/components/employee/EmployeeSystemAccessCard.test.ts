import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("EmployeeSystemAccessCard — UI e confirmações", () => {
  it("card chama status/link/unlink e exige confirm", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/employee/EmployeeSystemAccessCard.tsx"),
      "utf8"
    );
    assert.ok(src.includes("Acesso ao sistema"));
    assert.ok(src.includes("/user-link-status"));
    assert.ok(src.includes("/link-user"));
    assert.ok(src.includes("/unlink-user"));
    assert.ok(src.includes("window.confirm"));
    assert.ok(src.includes("Não cria conta nesta tela"));
    assert.ok(src.includes('to="/settings"'));
  });

  it("EmployeeModule monta o card e não obriga vínculo na criação", () => {
    const mod = readFileSync(join(process.cwd(), "src/components/EmployeeModule.tsx"), "utf8");
    assert.ok(mod.includes("EmployeeSystemAccessCard"));
    assert.ok(mod.includes("Acesso ao sistema"));
    assert.ok(mod.includes("AppUser é feito depois"));
    assert.ok(!mod.includes("linkSystemUser"));
  });
});
