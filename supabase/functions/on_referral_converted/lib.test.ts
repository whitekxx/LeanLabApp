import { assertEquals } from "https://deno.land/std@0.221.0/testing/asserts.ts";
import { referralBonus, REFERRAL_BONUS } from "./lib.ts";

Deno.test("referral bonus constant", () => {
  assertEquals(referralBonus(), 10);
  assertEquals(REFERRAL_BONUS, 10);
});
