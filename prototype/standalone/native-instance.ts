/** Repair the native one-shot BroadcastChannel lock without ignoring a live owner. */
export function nativeInstanceRecovery({
  channel,
  lock,
  report = (_event: string) => {},
  delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  channel: BroadcastChannel;
  lock: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  report?: (event: string) => void;
  delay?: (ms: number) => Promise<void>;
}) {
  let valid = () => true,
    restore = () => {},
    conflicts = 0;
  let pending: Promise<boolean> | undefined;
  let blockedDialog: { hide(): void } | undefined;
  const dialogs = new WeakSet<object>();
  channel.addEventListener('message', (event) => {
    if (event.data === 'conflict') conflicts++;
  });
  const guard = {
    bind(read: () => boolean, reset: () => void) {
      valid = read;
      restore = reset;
    },
    valid: () => valid(),
    watchDialog(dialog: any) {
      if (dialogs.has(dialog)) return;
      dialogs.add(dialog);
      const show = dialog.show,
        showNoButtons = dialog.showNoButtons,
        hide = dialog.hide;
      dialog.show = function (...args: unknown[]) {
        if (blockedDialog === this) blockedDialog = undefined;
        return show.apply(this, args);
      };
      dialog.hide = function (...args: unknown[]) {
        if (blockedDialog === this) blockedDialog = undefined;
        return hide.apply(this, args);
      };
      dialog.showNoButtons = function (...args: unknown[]) {
        const result = showNoButtons.apply(this, args);
        // This native method is used for the no-buttons instance warning. Track
        // its actual owner so recovery never dismisses an unrelated modal.
        if (!valid()) {
          blockedDialog = this;
          report('native_instance_blocked');
          void guard.check();
        }
        return result;
      };
    },
    check(): Promise<boolean> {
      if (valid()) return Promise.resolve(true);
      if (pending) return pending;
      pending = (async () => {
        const recovered = await lock(async () => {
          if (valid()) return true;
          const before = conflicts;
          channel.postMessage('new-instance');
          await delay(1500);
          if (conflicts !== before) {
            report('native_instance_owner_present');
            return false;
          }
          restore();
          const dialog = blockedDialog;
          blockedDialog = undefined;
          dialog?.hide();
          report('native_instance_recovered');
          return true;
        });
        return recovered === true || valid();
      })()
        .catch(() => {
          report('native_instance_probe_failed');
          return valid();
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
    dispose() {
      channel.close();
    },
  };
  return guard;
}

export function installNativeInstanceRecovery(
  runtime: any,
  insert: unknown,
  report: (event: string, detail?: any) => void,
) {
  // Recovery is serialized across tabs. Without Web Locks retain native safety
  // rather than allowing two blocked tabs to promote themselves simultaneously.
  if (!window.BroadcastChannel) return;
  const guard = nativeInstanceRecovery({
    channel: new BroadcastChannel('polytrack-single-instance'),
    lock: (action) => navigator.locks
      ? navigator.locks.request('polycup-native-instance-recovery', { ifAvailable: true }, (lease) => lease ? action() : undefined)
      : Promise.resolve(undefined),
    report: (phase) => report('stage', { phase }),
  });
  (window as any).polycupNativeInstance = guard;
  runtime.registerGlobalMixin({
    type: insert,
    token: 'let Pl = !0;',
    func: 'window.polycupNativeInstance.bind(()=>Pl,()=>{Pl=true;});',
  });
  runtime.registerGlobalMixin({
    type: insert,
    token: 'const x = document.getElementById("ui");',
    func: 'window.polycupNativeInstance.watchDialog(f);',
  });
  const timer = setInterval(() => {
    if (!guard.valid()) void guard.check();
  }, 3000);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) {
      clearInterval(timer);
      guard.dispose();
    }
  });
}

export async function requireNativeInstance() {
  const guard = (window as any).polycupNativeInstance;
  if (guard && !(await guard.check()))
    throw Error('Another PolyCup window is still active. Close it before joining a match.');
}
