import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_BRANDING } from "../types/branding.js";
import {
  isPrintCoverLogoLightOnDark,
  resolvePrintCoverLogoSrc,
  resolvePrintLogoSrc,
} from "./printBranding.js";

const PNG = "data:image/png;base64,abc";

describe("printBranding", () => {
  it("capa prioriza darkLogoDataUrl (logo para fundo escuro)", () => {
    const branding = {
      ...DEFAULT_BRANDING,
      darkLogoDataUrl: PNG,
      proposalLogoDataUrl: "data:image/png;base64,proposal",
    };
    assert.equal(resolvePrintCoverLogoSrc(branding), PNG);
    assert.equal(isPrintCoverLogoLightOnDark(branding, PNG), true);
  });

  it("páginas internas priorizam logo escura sobre fundo claro", () => {
    const branding = {
      ...DEFAULT_BRANDING,
      darkLogoDataUrl: PNG,
      proposalLogoDataUrl: "data:image/png;base64,proposal",
      systemExpandedLogoDataUrl: "data:image/png;base64,expanded",
    };
    assert.equal(resolvePrintLogoSrc(branding), "data:image/png;base64,proposal");
    assert.equal(resolvePrintCoverLogoSrc(branding), PNG);
  });
});
