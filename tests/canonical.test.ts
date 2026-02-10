import { describe, it, expect } from "vitest";
import { canonicalJson } from "../src/audit/canonical.js";

describe("canonicalJson", () => {
  // ----- key ordering -----

  it("sorts top-level keys lexicographically", () => {
    expect(canonicalJson({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts nested object keys recursively", () => {
    expect(canonicalJson({ b: { z: 1, a: 2 }, a: 1 })).toBe(
      '{"a":1,"b":{"a":2,"z":1}}',
    );
  });

  it("sorts deeply nested keys", () => {
    expect(canonicalJson({ c: { b: { a: 1 } } })).toBe(
      '{"c":{"b":{"a":1}}}',
    );
  });

  // ----- arrays -----

  it("preserves array element order", () => {
    expect(canonicalJson({ items: [3, 1, 2] })).toBe('{"items":[3,1,2]}');
  });

  it("sorts keys inside objects within arrays", () => {
    expect(canonicalJson([{ b: 2, a: 1 }])).toBe('[{"a":1,"b":2}]');
  });

  // ----- undefined / null -----

  it("omits undefined values", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe(
      '{"a":1,"c":3}',
    );
  });

  it("omits undefined in nested objects", () => {
    expect(canonicalJson({ a: { x: 1, y: undefined }, b: 2 })).toBe(
      '{"a":{"x":1},"b":2}',
    );
  });

  it("preserves null", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  // ----- Date -----

  it("converts Date objects to ISO 8601 strings", () => {
    const date = new Date("2026-02-09T12:00:00.000Z");
    expect(canonicalJson({ ts: date })).toBe(
      '{"ts":"2026-02-09T12:00:00.000Z"}',
    );
  });

  // ----- primitive types -----

  it("handles strings, numbers, booleans correctly", () => {
    expect(canonicalJson({ s: "hello", n: 42, b: true })).toBe(
      '{"b":true,"n":42,"s":"hello"}',
    );
  });

  it("serialises top-level primitives", () => {
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
  });

  // ----- empty structures -----

  it("handles empty objects and arrays", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  // ----- determinism -----

  it("is deterministic: same logical input → identical output", () => {
    const obj = { z: [3, 2, 1], a: { y: "hello", x: 42 } };
    const r1 = canonicalJson(obj);
    const r2 = canonicalJson(obj);
    // rebuild from parse to get a fresh object with potentially different key order
    const r3 = canonicalJson(JSON.parse(JSON.stringify(obj)));
    expect(r1).toBe(r2);
    expect(r1).toBe(r3);
  });

  it("key insertion order does not affect output", () => {
    const a: Record<string, number> = {};
    a["z"] = 1;
    a["a"] = 2;

    const b: Record<string, number> = {};
    b["a"] = 2;
    b["z"] = 1;

    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  // ----- mixed complex structure -----

  it("handles a realistic event-like structure", () => {
    const event = {
      type: "RunStarted",
      seq: 1,
      actor: { actorType: "human", actorId: "user-1" },
      payload: { metadata: { env: "test" } },
      eventId: "evt-1",
    };
    const json = canonicalJson(event);
    // Keys must be sorted at every level
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed)).toEqual([
      "actor",
      "eventId",
      "payload",
      "seq",
      "type",
    ]);
    expect(Object.keys(parsed.actor)).toEqual(["actorId", "actorType"]);
  });
});
