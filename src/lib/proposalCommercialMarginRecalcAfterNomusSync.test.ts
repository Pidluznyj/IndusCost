import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROPOSAL_COMMERCIAL_RECALC_CONFIRM,
} from "./proposalCommercialMarginRecalc.js";
import {
  PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC_ENV,
  PROPOSAL_COMMERCIAL_MARGIN_RECALC_CONFIRM_ENV,
  buildProposalMarginRecalcArgsForAfterSync,
  formatProposalMarginRecalcAfterSyncLog,
  resolveProposalMarginRecalcAfterSyncDecision,
} from "./proposalCommercialMarginRecalcAfterNomusSync.js";

describe("proposalCommercialMarginRecalcAfterNomusSync — decisão", () => {
  it("default é dry-run com forceFromFormation e source IMPORTED", () => {
    const d = resolveProposalMarginRecalcAfterSyncDecision({ argv: [], env: {} });
    assert.equal(d.mode, "dry-run");
    assert.equal(d.forceFromFormation, true);
    assert.equal(d.source, "IMPORTED");
    assert.equal(d.applyDowngradedToDryRun, false);
  });

  it("--skip-margin-recalc desliga", () => {
    const d = resolveProposalMarginRecalcAfterSyncDecision({
      argv: ["--skip-margin-recalc"],
      env: { [PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC_ENV]: "apply" },
    });
    assert.equal(d.mode, "off");
  });

  it("CLI prevalece sobre env", () => {
    const d = resolveProposalMarginRecalcAfterSyncDecision({
      argv: ["--margin-recalc=off"],
      env: { [PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC_ENV]: "apply" },
    });
    assert.equal(d.mode, "off");
  });

  it("apply sem confirmação desce para dry-run", () => {
    const d = resolveProposalMarginRecalcAfterSyncDecision({
      argv: ["--margin-recalc=apply"],
      env: {},
    });
    assert.equal(d.mode, "dry-run");
    assert.equal(d.applyDowngradedToDryRun, true);
  });

  it("apply com confirmação CLI permanece apply", () => {
    const d = resolveProposalMarginRecalcAfterSyncDecision({
      argv: [
        "--margin-recalc=apply",
        `--confirm-margin-recalc=${PROPOSAL_COMMERCIAL_RECALC_CONFIRM}`,
      ],
      env: {},
    });
    assert.equal(d.mode, "apply");
    assert.equal(d.applyDowngradedToDryRun, false);
  });

  it("apply com confirmação via env permanece apply", () => {
    const d = resolveProposalMarginRecalcAfterSyncDecision({
      argv: [],
      env: {
        [PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC_ENV]: "apply",
        [PROPOSAL_COMMERCIAL_MARGIN_RECALC_CONFIRM_ENV]: PROPOSAL_COMMERCIAL_RECALC_CONFIRM,
      },
    });
    assert.equal(d.mode, "apply");
    assert.equal(d.applyDowngradedToDryRun, false);
  });

  it("build args marca apply + forceFromFormation", () => {
    const d = resolveProposalMarginRecalcAfterSyncDecision({
      argv: [
        "--margin-recalc=apply",
        `--confirm-margin-recalc=${PROPOSAL_COMMERCIAL_RECALC_CONFIRM}`,
        "--margin-recalc-source=ALL",
      ],
      env: {},
    });
    const args = buildProposalMarginRecalcArgsForAfterSync(d);
    assert.equal(args.apply, true);
    assert.equal(args.confirmApply, PROPOSAL_COMMERCIAL_RECALC_CONFIRM);
    assert.equal(args.forceFromFormation, true);
    assert.equal(args.source, "ALL");
    assert.equal(args.onlyMissing, false);
  });

  it("format log cobre modes", () => {
    assert.match(
      formatProposalMarginRecalcAfterSyncLog({
        enabled: false,
        skipped: true,
        skipReason: "mode=off",
        mode: "off",
        applyDowngradedToDryRun: false,
      }),
      /desabilitado/
    );
    assert.match(
      formatProposalMarginRecalcAfterSyncLog({
        enabled: true,
        skipped: false,
        mode: "dry-run",
        applyDowngradedToDryRun: true,
        preview: {
          proposalsAnalyzed: 2,
          itemsAnalyzed: 5,
          itemsComplete: 4,
          itemsPartialProposal: 0,
          itemsUnavailable: 1,
          itemsChanged: 3,
          coveredNetValue: 100,
          totalNetValue: 120,
          coveragePercent: 83.33,
          bySource: {
            EXACT_PROPOSAL_FORMATION_SNAPSHOT: 0,
            EXACT_PROPOSAL_PRICE_TABLE_VERSION: 1,
            RECONSTRUCTED_FROM_PROPOSAL_DATE: 3,
            UNAVAILABLE: 1,
          },
          byReasonCode: {},
          marginBandCounts: {},
          negativeMarginItems: 0,
          totalConcession: 0,
          totalExplicitDiscount: 0,
          results: [],
          pagesProcessed: 1,
        },
      }),
      /mode=dry-run/
    );
  });
});
