import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS,
  SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS,
} from "./settingsGlobalsRoutes.js";

describe("settingsGlobalsRoutes", () => {
  function read(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("expõe rota de parâmetros globais", () => {
    const lib = read("src/lib/settingsGlobalsRoutes.ts");
    const server = read("server.ts");
    assert.match(lib, /\/api\/settings\/globals/);
    assert.doesNotMatch(lib, /production-hour-cost-simulations/);
    assert.match(server, /registerSettingsGlobalsRoutes/);
  });

  it("usa permissões bootstrap + settings.global_params", () => {
    assert.ok(SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS.includes("settings.global_params.view"));
    assert.ok(SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS.includes("settings.global_params.edit"));
  });
});
