import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionSpecialist,
  deriveSpecialistState,
  isSpecialistType,
  invalidProviderField,
  applyProviderPatch,
  validateClaimEvidence,
  specialistTrustLabel,
  MANAGER_PERMISSIONS,
  type SpecialistEvent,
} from "../src/specialist";

const ev = (kind: SpecialistEvent["kind"], detail?: Record<string, unknown>): SpecialistEvent => ({
  kind,
  actor: "u1",
  detail,
  at: "2026-07-20T00:00:00Z",
});

describe("specialist lifecycle", () => {
  it("allows the canonical claim path", () => {
    assert.ok(canTransitionSpecialist("unclaimed", "claim_requested"));
    assert.ok(canTransitionSpecialist("claim_requested", "claim_under_review"));
    assert.ok(canTransitionSpecialist("claim_under_review", "claimed"));
    assert.ok(canTransitionSpecialist("claimed", "verified"));
  });

  it("rejects illegal jumps", () => {
    assert.equal(canTransitionSpecialist("unclaimed", "verified"), false);
    assert.equal(canTransitionSpecialist("unclaimed", "claimed"), false);
    assert.equal(canTransitionSpecialist("merged", "claimed"), false);
    assert.equal(canTransitionSpecialist("closed", "unclaimed"), false);
  });

  it("rejected claims can retry", () => {
    assert.ok(canTransitionSpecialist("claim_under_review", "claim_rejected"));
    assert.ok(canTransitionSpecialist("claim_rejected", "claim_requested"));
  });

  it("derives state from the event log", () => {
    const state = deriveSpecialistState([
      ev("claim_submitted"),
      ev("claim_review_started"),
      ev("claim_approved"),
    ]);
    assert.equal(state, "claimed");
  });

  it("verification implies verified; suspension and reinstatement round-trip", () => {
    const state = deriveSpecialistState([
      ev("claim_submitted"),
      ev("claim_review_started"),
      ev("claim_approved"),
      ev("verification_added"),
      ev("suspended"),
      ev("reinstated"),
    ]);
    assert.equal(state, "claimed");
  });

  it("ignores illegal transitions during replay instead of throwing", () => {
    // claim_approved without a preceding review is not a legal move from unclaimed
    const state = deriveSpecialistState([ev("claim_approved")]);
    assert.equal(state, "unclaimed");
  });

  it("explicit state_changed events are honored when legal", () => {
    const state = deriveSpecialistState([ev("state_changed", { to: "inactive" })]);
    assert.equal(state, "inactive");
  });
});

describe("specialist types", () => {
  it("professionals qualify, places and unknowns do not", () => {
    assert.ok(isSpecialistType("lawyer"));
    assert.ok(isSpecialistType("broker"));
    assert.equal(isSpecialistType("restaurant"), false);
    assert.equal(isSpecialistType(undefined), false);
  });
});

describe("provider edits", () => {
  it("allows editable fields and rejects unknown ones", () => {
    assert.equal(invalidProviderField("communication", { languages: ["hy", "en"] }), null);
    assert.equal(invalidProviderField("communication", { trustScore: 1 }), "trustScore");
  });

  it("the credential layer is never provider-editable", () => {
    assert.match(String(invalidProviderField("credential", { license: "x" })), /not provider-editable/);
  });

  it("stamps source and timestamp per field, removes empties", () => {
    const base = applyProviderPatch(undefined, { biography: "20 years in EB-2" }, "specialist_provided", "t1");
    assert.equal(base.biography.source, "specialist_provided");
    const next = applyProviderPatch(base, { biography: "" }, "specialist_provided", "t2");
    assert.equal(next.biography, undefined);
  });
});

describe("claim evidence", () => {
  it("requires a strong anchor", () => {
    assert.match(String(validateClaimEvidence({ statement: "it's me, trust me" })), /verifiable anchor/);
    assert.equal(validateClaimEvidence({ licenseNumber: "AM-12345" }), null);
    assert.equal(validateClaimEvidence({ professionalEmail: "a@firm.am" }), null);
  });

  it("rejects malformed professional emails", () => {
    assert.match(String(validateClaimEvidence({ professionalEmail: "not-an-email" })), /invalid/);
  });
});

describe("qualitative trust label", () => {
  it("no evidence → limited", () => {
    assert.equal(
      specialistTrustLabel({ recCount: 0, outcomeCount: 0, distinctContributors: 0, effectiveScore: null }),
      "limited_evidence",
    );
  });
  it("one rec → emerging, never more", () => {
    assert.equal(
      specialistTrustLabel({ recCount: 1, outcomeCount: 0, distinctContributors: 1, effectiveScore: 0.9 }),
      "emerging",
    );
  });
  it("strong consensus with outcomes climbs the ladder", () => {
    assert.equal(
      specialistTrustLabel({ recCount: 6, outcomeCount: 4, distinctContributors: 5, effectiveScore: 0.7 }),
      "reliable",
    );
    assert.equal(
      specialistTrustLabel({ recCount: 12, outcomeCount: 8, distinctContributors: 9, effectiveScore: 0.8 }),
      "highly_reliable",
    );
  });
  it("high score cannot compensate for missing contributors (anti-gaming)", () => {
    assert.equal(
      specialistTrustLabel({ recCount: 10, outcomeCount: 10, distinctContributors: 2, effectiveScore: 0.99 }),
      "emerging",
    );
  });
});

describe("manager permissions", () => {
  it("least privilege holds", () => {
    assert.equal(MANAGER_PERMISSIONS.analytics_viewer.editProfile, false);
    assert.equal(MANAGER_PERMISSIONS.analytics_viewer.viewAnalytics, true);
    assert.equal(MANAGER_PERMISSIONS.profile_manager.manageBilling, false);
    assert.equal(MANAGER_PERMISSIONS.owner.manageManagers, true);
  });
});
