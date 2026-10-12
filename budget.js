// Budget vs actual for one matter's defense spend. Pure. Used by alerts (server) and screens (browser).
export const BUDGET_WARN = 0.75;
export function budgetStatus(c) {
  const b = (c && c.billing) || {}, budget = Number(b.budget) || 0, billed = Number(b.totalBilled) || 0;
  if (!(budget > 0)) return { budget: 0, billed, pct: null, level: 'none' };
  const pct = billed / budget;
  return { budget, billed, pct, level: pct >= 1 ? 'over' : pct >= BUDGET_WARN ? 'warn' : 'ok', left: budget - billed };
}
