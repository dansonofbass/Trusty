import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_EVENT_TYPES, isDomainEventType, validateDomainEvent } from "../src/domainEvents";

describe("domain event taxonomy", () => {
  it("types are unique, dot-namespaced, snake_case", () => {
    assert.equal(new Set(DOMAIN_EVENT_TYPES).size, DOMAIN_EVENT_TYPES.length);
    for (const t of DOMAIN_EVENT_TYPES) {
      assert.match(t, /^[a-z_]+\.[a-z_]+$/, t);
    }
  });

  it("guard accepts known types only", () => {
    assert.ok(isDomainEventType("squad.joined"));
    assert.equal(isDomainEventType("squad.exploded"), false);
  });

  it("validateDomainEvent fills defaults and rejects garbage", () => {
    const ok = validateDomainEvent({ type: "feedback.submitted", source: "web", userId: "u1" });
    assert.ok(ok);
    assert.equal(ok?.type, "feedback.submitted");
    assert.ok(ok?.id.startsWith("ev_"));
    assert.ok(!Number.isNaN(Date.parse(ok!.ts)));

    assert.equal(validateDomainEvent({ type: "not.a_type", source: "web" }), null);
    assert.equal(validateDomainEvent({ type: "feedback.submitted", source: "evil" }), null);
    assert.equal(validateDomainEvent(null), null);
  });
});
