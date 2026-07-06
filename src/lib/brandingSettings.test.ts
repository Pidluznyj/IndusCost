import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBrandingSettings, updateBrandingSettings } from "./brandingSettings.server.js";
import { prisma } from "./prisma.js";

describe("Branding Settings Service", () => {
  it("carrega e salva configurações de identidade visual", async () => {
    let mockRecord: any = null;

    // Mock Prisma methods
    prisma.brandingSettings.findFirst = async () => mockRecord;
    prisma.brandingSettings.create = async (args: any) => {
      mockRecord = { id: "mock-id-123", ...args.data };
      return mockRecord;
    };
    prisma.brandingSettings.update = async (args: any) => {
      mockRecord = { ...mockRecord, ...args.data };
      return mockRecord;
    };

    // 1. Get branding settings should create defaults if null
    const defaults = await getBrandingSettings();
    assert.ok(defaults.id);
    assert.equal(defaults.companyName, "Lazarios Koppetel");
    assert.equal(defaults.primaryColor, "#0EA5E9");

    // 2. Update branding settings
    const updated = await updateBrandingSettings({
      companyName: "Novas Industrias",
      tradeName: "Novas",
      primaryColor: "#FF5500",
      secondaryColor: "#00FF55",
      logoBase64: "data:image/png;base64,mockedlogo",
    });

    assert.equal(updated.companyName, "Novas Industrias");
    assert.equal(updated.primaryColor, "#FF5500");
    assert.equal(updated.logoBase64, "data:image/png;base64,mockedlogo");
  });
});
