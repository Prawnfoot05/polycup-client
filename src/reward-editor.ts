import { rewardRarity, rarityOrder } from './reward-rarity.ts';
import { element as h } from './dom.ts';
import {
  cosmeticCatalog,
  cosmetic,
  cosmeticURL,
  cosmeticBadge,
  requirement,
  rewardCondition,
  stylePlayerTitle,
  titleName,
  type CosmeticCollection,
  type CosmeticKind,
  type EquippedCosmetics,
  type CosmeticItem,
} from './cosmetics.ts';
import {
  achievementFamilies,
  challengeName,
  familyRepresentative,
  familyHighestUnlocked,
  equipFamilyTier,
} from './reward-families.ts';
import { socialIcon } from './social-icons.ts';
import css from './reward-editor.css';
export const rewardEditorCSS = css;
let editorCount = 0;
const lockGlyph = () => {
  const lock = h('span', undefined, 'reward-lock');
  lock.append(socialIcon('lock'));
  return lock;
};
/** A thin bar with its count; the numbers stay readable, the bar shows distance at a glance. */
export const rewardGoal = (progress: number, target: number) => {
  const row = h('span', undefined, 'reward-goal');
  const bar = h('progress');
  bar.max = target;
  bar.value = Math.min(progress, target);
  bar.setAttribute('aria-hidden', 'true');
  row.append(bar, h('span', `${Math.min(progress, target)} / ${target}`));
  return row;
};
const conditionBlock = (item: CosmeticItem, state: { progress: number; unlocked: boolean }) => {
  const block = h('span', undefined, 'reward-condition');
  const condition = rewardCondition(item);
  block.append(h('span', condition.label, 'reward-condition-label'));
  if (condition.note) block.append(h('small', condition.note, 'reward-condition-note'));
  if (item.metric.startsWith('season'))
    block.append(h('span', state.unlocked ? 'Awarded' : 'Pending', 'reward-condition-state'));
  else if (item.metric !== 'open') block.append(rewardGoal(state.progress, item.target));
  return block;
};
export function rewardEditor(
  collection: CosmeticCollection,
  options: {
    preview: (selection: EquippedCosmetics) => void;
    save: (selection: EquippedCosmetics) => Promise<void>;
    cancel: () => void;
    banners?: HTMLElement;
    accent?: HTMLElement;
    /** Receives Save / Cancel so a host can pin them outside the scrolling editor. */
    actions?: (footer: HTMLElement) => void;
  },
) {
  const form = h('form', undefined, 'reward-editor');
  form.setAttribute('aria-label', options.banners ? 'Profile appearance' : 'Profile rewards');
  const selection: Required<EquippedCosmetics> = {
    title_id: collection.title_id ?? null,
    frame_id: null,
    achievement_ids: [...(collection.achievement_ids ?? [])],
    achievement_variants: { ...(collection.achievement_variants ?? {}) },
  };
  const unlocked = new Map(collection.items.map((item) => [item.id, item]));
  const nav = h('nav'),
    grid = h('div', undefined, 'reward-options'),
    status = h('p', '', 'social-error');
  status.setAttribute('role', 'alert');
  nav.setAttribute('aria-label', 'Reward type');
  nav.setAttribute('role', 'tablist');
  grid.setAttribute('role', 'tabpanel');
  grid.id = 'profile-reward-options';
  type Tab = CosmeticKind | 'banner' | 'accent';
  let tab: Tab = options.banners ? 'banner' : 'title';
  const buttons = new Map<Tab, HTMLButtonElement>();
  const familyKey = (item: CosmeticItem) => `${item.family}:${item.metric}`;
  const tooltip = h('div', undefined, 'reward-family-tooltip');
  tooltip.id = 'profile-challenge-tiers';
  tooltip.setAttribute('popover', 'auto');
  tooltip.setAttribute('role', 'dialog');
  let previewAnchor: HTMLButtonElement | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const hidePreview = () => {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    previewAnchor?.setAttribute('aria-expanded', 'false');
    previewAnchor = undefined;
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
  };
  const scheduleHide = () => {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hidePreview, 180);
  };
  form.addEventListener('wheel', hidePreview, { passive: true });
  tooltip.onpointerenter = () => clearTimeout(closeTimer);
  tooltip.onpointerleave = (event) => {
    if (event.pointerType === 'mouse') scheduleHide();
  };
  tooltip.addEventListener('focusout', (event) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      (!tooltip.contains(event.relatedTarget) && !previewAnchor?.contains(event.relatedTarget))
    )
      scheduleHide();
  });
  tooltip.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed') {
      previewAnchor?.setAttribute('aria-expanded', 'false');
      previewAnchor = undefined;
    }
  });
  const showFamily = (anchor: HTMLButtonElement, tiers: CosmeticItem[]) => {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    if (previewAnchor === anchor && tooltip.matches(':popover-open')) return;
    hidePreview();
    previewAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    tooltip.setAttribute('aria-label', challengeName(tiers[0]) + ' medals');
    const heading = h('div', undefined, 'reward-family-heading');
    const goal = h('span', undefined, 'reward-family-goal');
    heading.append(h('strong', challengeName(tiers[0])), goal);
    const strip = h('div', undefined, 'reward-family-medals');
    const highest = Math.max(...tiers.map((tier) => unlocked.get(tier.id)!.progress));
    goal.textContent = String(highest);
    for (const base of tiers) {
      const item = cosmetic(base.id, base.kind, unlocked.get(base.id)?.variant)!;
      const state = unlocked.get(item.id)!;
      const selected = selection.achievement_ids.includes(item.id);
      const blocked =
        !state.unlocked ||
        (selection.achievement_ids.length === 3 &&
          !tiers.some((tier) => selection.achievement_ids.includes(tier.id)));
      const button = h('button', undefined, 'reward-family-medal');
      button.type = 'button';
      button.dataset.rewardId = item.id;
      button.dataset.rarity = item.rarity;
      button.style.setProperty('--reward-rarity', rewardRarity(item.rarity).color);
      button.setAttribute('aria-label', item.name);
      button.setAttribute(
        'aria-description',
        `${rewardRarity(item.rarity).name} � ${requirement(item)} � ${state.unlocked ? 'Unlocked' : Math.min(state.progress, item.target) + ' / ' + item.target}`,
      );
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-disabled', String(blocked));
      button.classList.toggle('is-locked', !state.unlocked);
      const image = h('img');
      image.src = cosmeticURL(item);
      image.alt = '';
      button.append(image, h('span', `${Math.min(state.progress, item.target)} / ${item.target}`));
      const showGoal = () => {
        goal.textContent = `${Math.min(state.progress, item.target)} / ${item.target}`;
      };
      button.onpointerenter = showGoal;
      button.onfocus = showGoal;
      button.onclick = () => {
        if (blocked) {
          showGoal();
          return;
        }
        selection.achievement_ids = equipFamilyTier(selection.achievement_ids, tiers, item.id);
        status.textContent = '';
        options.preview(selection);
        draw();
        [...grid.querySelectorAll<HTMLButtonElement>('[data-reward-family]')]
          .find((card) => card.dataset.rewardFamily === familyKey(item))
          ?.focus({ preventScroll: true });
      };
      strip.append(button);
    }
    tooltip.replaceChildren(heading, strip);
    tooltip.showPopover();
    const a = anchor.getBoundingClientRect(),
      box = tooltip.getBoundingClientRect();
    tooltip.dataset.placement = a.top - box.height - 10 >= 12 ? 'above' : 'below';
    const left = Math.max(
      12,
      Math.min(a.left + (a.width - box.width) / 2, innerWidth - box.width - 12),
    );
    tooltip.style.left = left + 'px';
    tooltip.style.setProperty(
      '--tier-tail-x',
      Math.max(12, Math.min(a.left + a.width / 2 - left, box.width - 12)) + 'px',
    );
    tooltip.style.top =
      Math.max(
        12,
        a.top - box.height - 10 >= 12
          ? a.top - box.height - 8
          : Math.min(a.bottom + 8, innerHeight - box.height - 12),
      ) + 'px';
  };
  const summary = h('div', undefined, 'reward-selection');
  const drawSummary = () => {
    summary.replaceChildren(h('span', `${selection.achievement_ids.length} / 3 achievements`));
    for (const id of selection.achievement_ids) {
      const badge = cosmeticBadge(id, unlocked.get(id)?.variant);
      if (badge) summary.append(badge);
    }
  };
  const draw = () => {
    hidePreview();
    grid.replaceChildren();
    grid.dataset.kind = tab;
    grid.classList.remove('reward-family-overview');
    grid.classList.toggle('reward-banner-panel', tab === 'banner' || tab === 'accent');
    summary.hidden = tab !== 'achievement';
    grid.setAttribute(
      'aria-label',
      tab === 'accent'
        ? 'Accent'
        : tab === 'banner'
          ? 'Banners'
          : tab === 'title'
            ? 'Titles'
            : tab === 'frame'
              ? 'Avatar frames'
              : 'Achievements',
    );
    for (const [kind, button] of buttons) {
      button.setAttribute('aria-selected', String(kind === tab));
      button.id = 'reward-tab-' + kind;
      button.setAttribute('aria-controls', grid.id);
      button.tabIndex = kind === tab ? 0 : -1;
    }
    grid.setAttribute('aria-labelledby', 'reward-tab-' + tab);
    if (tab === 'banner') {
      grid.append(options.banners!);
      return;
    }
    if (tab === 'accent') {
      grid.append(options.accent!);
      return;
    }
    let items = cosmeticCatalog
      .filter((item) => item.enabled && item.kind === tab && unlocked.has(item.id))
      .sort(
        (a, b) =>
          rarityOrder(cosmetic(a.id, a.kind, unlocked.get(a.id)?.variant)!.rarity) -
          rarityOrder(cosmetic(b.id, b.kind, unlocked.get(b.id)?.variant)!.rarity),
      );
    const families = tab === 'achievement' ? achievementFamilies(items) : [];
    const familyOf = (item: CosmeticItem) =>
      families.find((group) => group.length > 1 && familyKey(group[0]) === familyKey(item));
    // A family card reports the best tier earned, not whichever tier happens to be equipped.
    const earnedRarity = (item: CosmeticItem) => {
      const group = familyOf(item);
      const top = group && familyHighestUnlocked(group, (id) => !!unlocked.get(id)?.unlocked);
      const shown = top ?? item;
      return cosmetic(shown.id, shown.kind, unlocked.get(shown.id)?.variant)!.rarity;
    };
    if (tab === 'achievement') {
      grid.classList.add('reward-family-overview');
      items = families
        .map((group) =>
          familyRepresentative(group, selection, (id) => !!unlocked.get(id)?.unlocked),
        )
        .sort((a, b) => rarityOrder(earnedRarity(a)) - rarityOrder(earnedRarity(b)));
    }
    const none = h('button', 'None', 'reward-option reward-none');
    none.type = 'button';
    if (tab !== 'achievement') {
      const key = tab === 'title' ? 'title_id' : 'frame_id';
      none.setAttribute('aria-pressed', String(!selection[key]));
      none.onclick = () => {
        selection[key] = null;
        options.preview(selection);
        draw();
        none.focus();
      };
      grid.append(none);
    }
    for (const base of items) {
      const item = cosmetic(base.id, base.kind, unlocked.get(base.id)?.variant)!;
      const family = tab === 'achievement' ? familyOf(base) : undefined;
      const state = unlocked.get(item.id)!,
        selected =
          tab === 'achievement'
            ? selection.achievement_ids.includes(item.id)
            : selection[tab === 'title' ? 'title_id' : 'frame_id'] === item.id;
      const button = h('button', undefined, 'reward-option');
      button.type = 'button';
      if (family) button.dataset.rewardFamily = familyKey(base);
      else button.dataset.rewardId = item.id;
      const rarityKey = family ? earnedRarity(base) : item.rarity;
      const rarity = rewardRarity(rarityKey);
      button.dataset.rarity = rarityKey;
      button.classList.toggle('is-title', item.kind === 'title');
      button.style.setProperty('--reward-rarity', rarity.color);
      button.title = `${rarity.name} · ${requirement(item)}`;
      button.setAttribute(
        'aria-label',
        family ? challengeName(item) : titleName(item, collection.global_position),
      );
      button.setAttribute('aria-pressed', String(selected));
      // Locked rewards stay focusable so touch and keyboard users can inspect the goal.
      button.setAttribute(
        'aria-disabled',
        String(
          !family &&
            (!state.unlocked ||
              (tab === 'achievement' && !selected && selection.achievement_ids.length === 3)),
        ),
      );
      button.classList.toggle('is-locked', !state.unlocked);
      if (item.art) {
        const art = h('span', undefined, 'reward-art');
        if (item.kind === 'frame') art.append(h('span', 'P', 'reward-avatar'));
        const image = h('img');
        image.src = cosmeticURL(item);
        image.alt = '';
        art.append(image);
        button.append(art);
      }
      const label = h(
        'strong',
        family ? challengeName(item) : titleName(item, collection.global_position),
      );
      if (tab === 'title') stylePlayerTitle(label, item, collection.global_position);
      button.append(label, h('span', rarity.name, 'reward-rarity-label'));
      if (family) {
        const goal =
          family.find((tier) => !unlocked.get(tier.id)?.unlocked) ?? family[family.length - 1];
        button.append(conditionBlock(goal, unlocked.get(goal.id)!));
        button.classList.add('reward-family');
        button.removeAttribute('title');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', tooltip.id);
        button.setAttribute('aria-expanded', 'false');
        button.onpointerenter = (event) => {
          clearTimeout(closeTimer);
          if (event.pointerType === 'mouse') {
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => {
              if (button.isConnected) showFamily(button, family);
            }, 180);
          }
        };
        button.onpointerleave = scheduleHide;
        button.onblur = (event) => {
          if (!(event.relatedTarget instanceof Node) || !tooltip.contains(event.relatedTarget))
            scheduleHide();
        };
      } else {
        if (!state.unlocked) button.prepend(lockGlyph());
        button.append(conditionBlock(item, state));
      }
      button.onclick = (event) => {
        if (family) {
          showFamily(button, family);
          if (event.detail === 0)
            (
              tooltip.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
              tooltip.querySelector<HTMLButtonElement>('button')
            )?.focus({ preventScroll: true });
          return;
        }
        if (button.getAttribute('aria-disabled') === 'true') return;
        if (tab === 'achievement')
          selection.achievement_ids = selected
            ? selection.achievement_ids.filter((id) => id !== item.id)
            : [...selection.achievement_ids, item.id];
        else selection[tab === 'title' ? 'title_id' : 'frame_id'] = item.id;
        status.textContent = '';
        options.preview(selection);
        draw();
        grid
          .querySelector<HTMLButtonElement>(`[data-reward-id="${item.id}"]`)
          ?.focus({ preventScroll: true });
      };
      grid.append(button);
    }
    grid.setAttribute('aria-labelledby', 'reward-tab-' + tab);
    drawSummary();
  };
  for (const [kind, label] of [
    ...(options.banners ? [['banner', 'Banners'] as const] : []),
    ['title', 'Titles'],
    ['achievement', 'Achievements'],
    ...(options.accent ? [['accent', 'Accent'] as const] : []),
  ] as const) {
    const button = h('button', label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.onclick = () => {
      tab = kind;
      draw();
      grid.scrollTop = 0;
    };
    buttons.set(kind, button);
    nav.append(button);
  }
  nav.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const kinds = [...buttons.keys()],
      index = kinds.indexOf(tab);
    tab =
      event.key === 'Home'
        ? kinds[0]
        : event.key === 'End'
          ? kinds[kinds.length - 1]
          : kinds[(index + (event.key === 'ArrowRight' ? 1 : kinds.length - 1)) % kinds.length];
    draw();
    grid.scrollTop = 0;
    buttons.get(tab)?.focus();
  };
  const footer = h('div', undefined, 'reward-actions'),
    cancel = h('button', 'Cancel'),
    save = h('button', options.banners ? 'Save appearance' : 'Save rewards', 'primary');
  cancel.type = 'button';
  cancel.onclick = options.cancel;
  save.type = 'submit';
  footer.append(cancel, save);
  form.append(nav, summary, grid, tooltip);
  if (options.actions) {
    // Hosted controls stay associated with this form through the form attribute.
    form.id = 'reward-editor-' + ++editorCount;
    save.setAttribute('form', form.id);
    footer.prepend(status);
    options.actions(footer);
  } else form.append(status, footer);
  draw();
  form.onsubmit = (event) => {
    event.preventDefault();
    if (save.disabled) return;
    hidePreview();
    const controls = [
      ...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input'),
      ...(options.actions ? footer.querySelectorAll('button') : []),
    ];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((b) => (b.disabled = true));
    save.textContent = 'Saving…';
    void options
      .save({ ...selection, achievement_ids: [...selection.achievement_ids] })
      .catch((error) => {
        status.textContent = error.message;
        controls.forEach((b, i) => (b.disabled = disabled[i]));
        save.textContent = options.banners ? 'Save appearance' : 'Save rewards';
      });
  };
  return form;
}
