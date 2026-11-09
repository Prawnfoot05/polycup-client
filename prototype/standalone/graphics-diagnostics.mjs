// Passive evidence only: never prevent context-loss handling, reload, or retire a racer.
// No GPU/device fingerprint, URLs, image contents, credentials or heap snapshots.
export function observeClientGraphics(report, {
  document: doc = document, frame = requestAnimationFrame, cancel = cancelAnimationFrame,
  room, active, now = () => performance.now(),
}) {
  let scope = '', count = 0, losses = 0, previous = 0, started = 0, pending;
  let frames = 0, samples = [];
  const reset = () => { previous = 0; started = 0; frames = 0; samples = []; };
  const emit = (event, detail) => { try { report(event, detail); } catch {} };
  const changeScope = () => {
    const key = room();
    if (scope !== key) { scope = key; count = 0; losses = 0; reset(); }
    return !!key;
  };
  const context = event => {
    if (!changeScope() || losses >= 12) return;
    // Capture is necessary: WebGL context events do not bubble.
    if (event.target?.tagName !== 'CANVAS') return;
    losses++;
    const phase = event.type === 'webglcontextlost' ? 'graphics_context_lost'
      : event.type === 'webglcontextrestored' ? 'graphics_context_restored' : 'graphics_context_error';
    emit(event.type === 'webglcontextrestored' ? 'stage' : 'client_error', { phase, message: phase });
    reset();
  };
  const tick = () => {
    pending = frame(tick);
    if (!changeScope() || doc.hidden || !active() || count >= 12) { reset(); return; }
    const at = now();
    if (!started) started = at;
    if (previous) {
      frames++;
      // Bounded, evenly spaced samples; counting every callback preserves average rate.
      if (frames % 4 === 0 && samples.length < 1000) samples.push(Math.min(120000, at - previous));
    }
    previous = at;
    if (at - started < 15000) return;
    const elapsed = at - started;
    const sorted = samples.sort((a, b) => a - b);
    const p95 = Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0);
    emit('stage', { phase: 'client_frame_timing', durationMs: Math.min(120000, Math.round(elapsed)),
      message: JSON.stringify({ browserFps: Math.round(frames * 1000 / elapsed), frameP95Ms: p95 }) });
    count++;
    reset();
  };
  for (const name of ['webglcontextlost', 'webglcontextrestored', 'webglcontextcreationerror']) doc.addEventListener(name, context, {capture:true});
  pending = frame(tick);
  return () => {
    cancel(pending);
    for (const name of ['webglcontextlost', 'webglcontextrestored', 'webglcontextcreationerror']) doc.removeEventListener(name, context, {capture:true});
  };
}
