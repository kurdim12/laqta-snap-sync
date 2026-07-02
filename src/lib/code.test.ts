import { describe, it, expect } from "vitest";
import { generateCode, newId } from "./code";

describe("generateCode", () => {
  it("returns 6 chars from the ambiguity-free alphabet (no O/0/I/1)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
  it("honors a custom length", () => {
    expect(generateCode(8)).toHaveLength(8);
  });
});

describe("newId", () => {
  it("looks like a UUID", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
  it("is unique across calls", () => {
    const set = new Set(Array.from({ length: 500 }, () => newId()));
    expect(set.size).toBe(500);
  });
});
