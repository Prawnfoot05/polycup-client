/** Compare equal checkpoints, never the live race clock or the ghost's current pose. */
export function copiumSplit(state, reference) {
  if (!state || !reference || ['waiting', 'error'].includes(state.phase)) return null;
  const valid = (n) => Number.isSafeInteger(n) && n > 0;
  if (state.phase === 'finished') {
    if (!valid(state.copium) || !valid(reference.finish)) return null;
    return { delta: state.copium - reference.finish, checkpoint: null, finished: true };
  }
  const times = state.checkpointTimes ?? [];
  for (let i = times.length - 1; i >= 0; i--) {
    const at = times[i];
    if (!valid(at) || at > state.copium) continue;
    const other = reference.checkpoints?.[i];
    // Loading/incomplete ghost data is unavailable, not a zero-time checkpoint.
    if (!valid(other)) return null;
    return { delta: at - other, checkpoint: i + 1, finished: false };
  }
  return null;
}
export function formatCopiumSplit(delta) {
  const ms = Math.abs(delta);
  return `${delta < 0 ? '−' : '+'}${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
