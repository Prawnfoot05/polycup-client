/** Native 0.6.3 treats transient ICE disconnection as terminal. Delay only those
 * notifications; channel closure, explicit disposal and failed ICE stay terminal. */
export function protectTransientDisconnect(
  pc: RTCPeerConnection,
  report: (phase: string) => void = () => {},
  delay = 15000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let releasing = false;
  let expired = false;
  const pending = new Set<string>();
  const terminal = () => ['closed', 'failed'].includes(pc.connectionState) ||
    ['closed', 'failed'].includes(pc.iceConnectionState);
  const disconnected = () => pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected';
  const clear = () => { clearTimeout(timer); timer = undefined; pending.clear(); };
  const changed = (event: Event) => {
    if (releasing) return;
    if (terminal()) { clear(); return; }
    if (!disconnected()) {
      if (timer !== undefined) report('rtc_recovered');
      clear(); expired = false; return;
    }
    const state = event.type === 'connectionstatechange' ? pc.connectionState : pc.iceConnectionState;
    if (state !== 'disconnected' || expired) return;
    event.stopImmediatePropagation();
    pending.add(event.type);
    if (timer !== undefined) return;
    report('rtc_recovering');
    timer = setTimeout(() => {
      timer = undefined;
      if (terminal() || !disconnected()) { pending.clear(); return; }
      expired = true;
      report('rtc_recovery_expired');
      const events = [...pending]; pending.clear();
      releasing = true;
      try {
        for (const type of events) {
          if (terminal()) break;
          const state = type === 'connectionstatechange' ? pc.connectionState : pc.iceConnectionState;
          if (state === 'disconnected') pc.dispatchEvent(new Event(type));
        }
      } finally { releasing = false; }
    }, delay);
  };
  pc.addEventListener('connectionstatechange', changed, true);
  pc.addEventListener('iceconnectionstatechange', changed, true);
  return () => {
    clear();
    pc.removeEventListener('connectionstatechange', changed, true);
    pc.removeEventListener('iceconnectionstatechange', changed, true);
  };
}
