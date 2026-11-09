import type { DrivingControls } from './types.ts';

export type DrivingDirection = 'up' | 'right' | 'down' | 'left';
export type DrivingBindings = Record<DrivingDirection, (string | null)[]>;

export function isEditing(event: Event, includeButtons = true) {
  return event.composedPath().some((target) => {
    const element = target as HTMLElement;
    return (
      ['INPUT', 'TEXTAREA', 'SELECT', ...(includeButtons ? ['BUTTON'] : [])].includes(
        element.tagName,
      ) || element.isContentEditable
    );
  });
}

export class HeldDrivingInputs {
  #bindings = new Map<string, DrivingDirection>();
  #held = new Set<string>();

  bind(bindings: DrivingBindings) {
    this.#bindings.clear();
    for (const direction of ['up', 'right', 'down', 'left'] as const)
      for (const code of bindings[direction])
        if (code && !this.#bindings.has(code)) this.#bindings.set(code, direction);
    for (const code of this.#held) if (!this.#bindings.has(code)) this.#held.delete(code);
  }

  press(event: KeyboardEvent) {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || isEditing(event))
      return;
    if (this.#bindings.has(event.code)) this.#held.add(event.code);
  }

  release(code: string) {
    this.#held.delete(code);
  }

  clear() {
    this.#held.clear();
  }

  controls(): DrivingControls {
    const controls = { up: false, right: false, down: false, left: false, reset: false };
    for (const code of this.#held) {
      const direction = this.#bindings.get(code);
      if (direction) controls[direction] = true;
    }
    return controls;
  }
}

// Keep resolved controls stable across layout changes, but retain unresolved
// finger positions too: a press can begin before the native controls are mounted.
// Only a still-held finger can resolve later; releases/cancellation remove it.
const touchHit = (x: number, y: number) =>
  typeof document === 'undefined' ? null : document.elementFromPoint(x, y);
const touchDirection = (target: Element | null) => {
  const src = target?.closest('.touch-controls-ui > div > div')?.querySelector('img')?.getAttribute('src') ?? '';
  return /(?:^|\/)arrow_(up|right|down|left)\.svg$/.exec(src)?.[1] as DrivingDirection | undefined;
};
export class HeldTouchInputs {
  #points: { x: number; y: number; direction?: DrivingDirection; eligible: boolean }[] = [];

  update(touches: TouchList, hitTest = touchHit) {
    this.#points = Array.from(touches, ({ clientX: x, clientY: y, target }) => ({
      x, y, direction: touchDirection(hitTest(x, y)),
      // A menu button/editor press must never turn into throttle after it closes.
      eligible: !(typeof Element !== 'undefined' && target instanceof Element &&
        target.closest('button,input,textarea,select,[contenteditable]')),
    }));
  }

  get active() { return this.#points.length > 0; }

  clear() { this.#points = []; }

  controls(hitTest = touchHit): DrivingControls {
    const controls = { up: false, right: false, down: false, left: false, reset: false };
    for (const point of this.#points) {
      if (!point.direction && point.eligible) point.direction = touchDirection(hitTest(point.x, point.y));
      if (point.direction) controls[point.direction] = true;
    }
    return controls;
  }
}
