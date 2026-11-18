import type { CupState } from './types.ts';
export function roundStartCue(state: CupState | null, sessionId: number | null, now: number) {
  const run = state?.runtime;
  if (
    !run ||
    run.sessionId === null ||
    run.sessionId !== sessionId ||
    run.startsAt === null ||
    !Number.isFinite(run.startsAt) ||
    !['countdown', 'racing'].includes(state.phase)
  )
    return '';
  return startCue(run.startsAt - now);
}

export function startCue(remaining: number) {
  if (remaining > 3000 || remaining <= -600) return '';
  return remaining > 0 ? String(Math.ceil(remaining / 1000)) : 'GO';
}
