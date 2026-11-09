/** Status authorization is a live-match concern, not an indefinite menu poll. */
export function rankedRoomIsActive(room: string, queue: any, phase?: string) {
  return (
    !!room &&
    queue?.state === 'matched' &&
    queue.match?.id === room &&
    ['drafting', 'racing'].includes(queue.match.status) &&
    phase !== 'complete'
  );
}
