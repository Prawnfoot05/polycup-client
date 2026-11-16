/** Native checkpoint indices are zero based; neither start nor finish is counted. */
export function checkpointLabel(
  row: { checkpoint?: number; frames?: number; dnf?: boolean },
  total: number | null | undefined,
) {
  if (total == null || !Number.isSafeInteger(total) || total < 0) return null;
  const checkpoint = Number.isSafeInteger(row.checkpoint) ? row.checkpoint! : -1;
  const reached = !row.dnf && row.frames !== undefined
    ? total
    : Math.max(0, Math.min(total, checkpoint + 1));
  return `CP ${reached}/${total}`;
}
