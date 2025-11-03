import { assertEquals } from "https://deno.land/std@0.221.0/testing/asserts.ts";
import { startOfWeek, canAwardReviewCredit } from "./lib.ts";

Deno.test("startOfWeek returns Monday 00:00 UTC", () => {
  const date = new Date(Date.UTC(2024, 6, 17, 15)); // Wed
  const start = startOfWeek(date);
  assertEquals(start.toISOString(), "2024-07-15T00:00:00.000Z");
});

Deno.test("canAwardReviewCredit allows up to two per week", () => {
  assertEquals(canAwardReviewCredit(0), true);
  assertEquals(canAwardReviewCredit(1), true);
  assertEquals(canAwardReviewCredit(2), false);
});
