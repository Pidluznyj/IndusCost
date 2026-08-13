import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SETTINGS_BRANDING_EDIT_PERMISSIONS,
  SETTINGS_BRANDING_VIEW_PERMISSIONS,
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
    assert.match(lib, /apply-hh-hm-simulation/);
    assert.doesNotMatch(lib, /production-hour-cost-simulations/);
    assert.match(server, /registerSettingsGlobalsRoutes/);
  });

  it("usa permissões bootstrap + settings.global_params", () => {
    assert.ok(SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS.includes("settings.global_params.view"));
    assert.ok(SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS.includes("settings.global_params.edit"));
  });

  it("branding usa permissões settings.branding", () => {
    const lib = read("src/lib/settingsGlobalsRoutes.ts");
    assert.match(lib, /SETTINGS_BRANDING_VIEW_PERMISSIONS/);
    assert.match(lib, /settings\.branding\.view/);
    assert.ok(SETTINGS_BRANDING_VIEW_PERMISSIONS.includes("settings.branding.view"));
    assert.ok(SETTINGS_BRANDING_EDIT_PERMISSIONS.includes("settings.branding.edit"));
    assert.match(lib, /getBrandingSettingsDto/);
    assert.match(lib, /requireAdminElevation/);
  });
});
