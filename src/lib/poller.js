// One poller per page. Pauses while the tab is hidden, never overlaps its own
// requests, and is always stopped by the owning page's unmount. No global timers.

export function createPoller(fn, { intervalMs, immediate = true } = {}) {
  let timer = null;
  let running = false;
  let stopped = false;
  let interval = intervalMs;

  const tick = async () => {
    if (stopped || running) return;
    if (document.visibilityState === 'hidden') return schedule();
    running = true;
    try { await fn(); } catch (e) { console.warn('[poller]', e); }
    running = false;
    schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!stopped && interval > 0) timer = setTimeout(tick, interval);
  };
  const onVis = () => { if (document.visibilityState === 'visible' && !stopped) tick(); };
  document.addEventListener('visibilitychange', onVis);
  if (immediate) tick(); else schedule();

  return {
    setInterval(ms) { interval = ms; schedule(); },
    stop() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    }
  };
}
