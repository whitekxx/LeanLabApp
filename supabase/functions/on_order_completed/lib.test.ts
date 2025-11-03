import { assertEquals } from "https://deno.land/std@0.221.0/testing/asserts.ts";
import { calculateEarn, roundCurrency } from "./lib.ts";

Deno.test("roundCurrency rounds to 2 decimals", () => {
  assertEquals(roundCurrency(1.234), 1.23);
  assertEquals(roundCurrency(1.235), 1.24);
});

Deno.test("calculateEarn matches acceptance scenario", () => {
  const result = calculateEarn({
    subtotal: 144,
    creditsRedeemed: 10,
    mealCount: 12,
    isSubscription: true,
    multiplier: 1,
  });
  assertEquals(result.credits, 16.08);
  assertEquals(result.rate, 0.12);
});
