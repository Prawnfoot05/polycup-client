// Only operation names, random correlation IDs and durations leave the browser.
// Never record SDP, candidates, URLs, invitations or profile/message contents.
export function timePeerOperations(pc, report, now = () => performance.now()) {
  const span = pc.polycupDiagnosticId;
  for (const [method, phase] of Object.entries({
    createOffer: 'offer', createAnswer: 'answer',
    setLocalDescription: 'local', setRemoteDescription: 'remote',
  })) {
    const original = pc[method].bind(pc);
    pc[method] = (...args) => {
      const at = now();
      const emit = suffix => { try { report('stage', {phase:'rtc_'+phase+'_'+suffix, span, durationMs:Math.round(now()-at)}); } catch {} };
      emit('start');
      let result;
      try { result = original(...args); } catch (error) { emit('error'); throw error; }
      // Retain native return/promise and rejection semantics.
      Promise.resolve(result).then(() => emit('done'), () => emit('error'));
      return result;
    };
  }
}

export function timeSignalSocket(ws, report, span, now = () => performance.now()) {
  const at = now();
  const emit = phase => { try { report('stage', {phase, span, durationMs:Math.round(now()-at)}); } catch {} };
  emit('signal_created');
  ws.addEventListener('open', () => emit('signal_open'));
  ws.addEventListener('error', () => emit('signal_error'));
  ws.addEventListener('close', event => {
    try { report('stage', {phase:'signal_closed', span, durationMs:Math.round(now()-at), closeCode:event.code, clean:event.wasClean}); } catch {}
  });
  const classify = (value, sending) => {
    try {
      if (typeof value !== 'string' || value.length > 65536) return;
      const m = JSON.parse(value);
      if (m?.offer) emit(sending ? 'signal_offer_sent' : 'signal_offer_received');
      else if (m?.type === 'acceptJoin') emit(sending ? 'signal_answer_sent' : 'signal_answer_received');
    } catch {}
  };
  const send = ws.send.bind(ws);
  ws.send = (...args) => { const result = send(...args); classify(args[0], true); return result; };
  ws.addEventListener('message', event => classify(event.data, false));
}

export function watchStartupStalls(report, {now = () => performance.now(), interval = setInterval, cancel = clearInterval} = {}) {
  let previous = now(), remaining = 12;
  const until = previous + 60000;
  const timer = interval(() => {
    const at = now(), lag = at - previous - 500;
    previous = at;
    if (lag >= 500 && remaining-- > 0) {
      try { report('stage', {phase:'startup_main_thread_stall', durationMs:Math.round(lag)}); } catch {}
    }
    if (at >= until) cancel(timer);
  }, 500);
  return () => cancel(timer);
}
