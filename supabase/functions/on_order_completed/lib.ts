export type EarnInput = {
  subtotal: number; // dollars
  creditsRedeemed: number; // dollars
  mealCount: number;
  isSubscription: boolean;
  multiplier: number;
};

export type EarnResult = {
  credits: number;
  rate: number;
  earnable: number;
};

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateEarn({ subtotal, creditsRedeemed, mealCount, isSubscription, multiplier }: EarnInput): EarnResult {
  const baseRate = mealCount >= 10 ? 0.09 : 0.04;
  const bonus = isSubscription ? 0.03 : 0;
  const effectiveRate = (baseRate + bonus) * (multiplier || 1);
  const earnable = Math.max(subtotal - creditsRedeemed, 0);
  const credits = roundCurrency(earnable * effectiveRate);
  return { credits, rate: effectiveRate, earnable: roundCurrency(earnable) };
}
