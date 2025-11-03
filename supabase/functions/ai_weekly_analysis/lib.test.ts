import { assertEquals } from "https://deno.land/std@0.221.0/testing/asserts.ts";
import { computeMultiplier } from "./lib.ts";

Deno.test("computeMultiplier boosts high score streaks", () => {
  assertEquals(computeMultiplier(90, 5), 1.05);
});

Deno.test("computeMultiplier nudges low scores", () => {
  assertEquals(computeMultiplier(40, 1), 0.97);
});

Deno.test("computeMultiplier defaults to baseline", () => {
  assertEquals(computeMultiplier(70, 2), 1.0);
});
