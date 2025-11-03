export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 (Sun) ... 6 (Sat)
  const diff = (day + 6) % 7; // Monday start
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function canAwardReviewCredit(existingCount: number) {
  return existingCount < 2;
}
