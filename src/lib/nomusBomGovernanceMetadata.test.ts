import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNomusControlledBomMetadata,
  describeNomusBomMetadataGap,
  needsNomusBomMetadataUpdate,
  NOMUS_BOM_METADATA_UPDATE_REASON,
} from "./nomusBomGovernanceMetadata";

describe("nomusBomGovernanceMetadata", () => {
  const syncedAt = new Date("2026-05-26T15:00:00.000Z");

  it("detecta metadata ausente em linha com quantidade já correta", () => {
    const row = {
      sourceSystem: null,
      isNomusControlled: false,
      nomusComponentCode: null,
      lastNomusSyncAt: null,
      lossPercentage: 0,
    };
    assert.equal(needsNomusBomMetadataUpdate(row, { componentCode: "115.01--" }), true);
    const gaps = describeNomusBomMetadataGap(row, { componentCode: "115.01--" });
    assert.ok(gaps.some((g) => g.includes("sourceSystem")));
    assert.ok(gaps.some((g) => g.includes("isNomusControlled")));
    assert.ok(gaps.some((g) => g.includes("nomusComponentCode")));
    assert.ok(gaps.some((g) => g.includes("lastNomusSyncAt")));
  });

  it("307.05AA / 115.01-- e 121.16-- — metadata completa não exige update", () => {
    const good = {
      sourceSystem: "NOMUS",
      isNomusControlled: true,
      nomusComponentCode: "115.01--",
      lastNomusSyncAt: syncedAt,
      lossPercentage: 0,
    };
    assert.equal(needsNomusBomMetadataUpdate(good, { componentCode: "115.01--" }), false);
    assert.equal(
      needsNomusBomMetadataUpdate(
        { ...good, nomusComponentCode: "121.16--" },
        { componentCode: "121.16--" }
      ),
      false
    );
  });

  it("lossPercentage != 0 exige correção", () => {
    assert.equal(
      needsNomusBomMetadataUpdate(
        {
          sourceSystem: "NOMUS",
          isNomusControlled: true,
          nomusComponentCode: "115.01--",
          lastNomusSyncAt: syncedAt,
          lossPercentage: 2.5,
        },
        { componentCode: "115.01--" }
      ),
      true
    );
  });

  it("localException=true nunca recebe governança Nomus", () => {
    assert.equal(
      needsNomusBomMetadataUpdate(
        {
          sourceSystem: null,
          isNomusControlled: false,
          nomusComponentCode: null,
          lastNomusSyncAt: null,
          lossPercentage: 0,
          localException: true,
        },
        { componentCode: "800.01--" }
      ),
      false
    );
  });

  it("buildNomusControlledBomMetadata preenche campos esperados", () => {
    const meta = buildNomusControlledBomMetadata(
      { componentCode: "121.16--", syncedAt },
      syncedAt
    );
    assert.equal(meta.sourceSystem, "NOMUS");
    assert.equal(meta.isNomusControlled, true);
    assert.equal(meta.nomusComponentCode, "121.16--");
    assert.equal(meta.lossPercentage, 0);
    assert.equal(meta.lastNomusSyncAt.toISOString(), syncedAt.toISOString());
  });

  it("motivo de auditoria está definido", () => {
    assert.match(NOMUS_BOM_METADATA_UPDATE_REASON, /controlada pelo Nomus/i);
  });
});
