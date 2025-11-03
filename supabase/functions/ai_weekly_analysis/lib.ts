export function computeMultiplier(score: number, streak: number) {
  if (score > 85 && streak >= 4) return 1.05;
  if (score < 50) return 0.97;
  return 1.0;
}
