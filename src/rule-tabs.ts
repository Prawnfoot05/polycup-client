import { element as h } from './dom.ts';
import css from './rule-tabs.css';

export type RuleCategory = 'race' | 'tracks' | 'timing' | 'players';
export type RuleTab = { key: RuleCategory; label: string; panel: HTMLElement };

/** Switch locally, without submitting settings or rebuilding the lobby. */
export function ruleTabs(tabs: RuleTab[], selected: RuleCategory, changed: (key: RuleCategory) => void) {
  const root = h('div', undefined, 'rule-tabs');
  root.append(h('style', css));
  const nav = h('div', undefined, 'rule-tabs-nav');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Lobby settings');
  const panels = h('div', undefined, 'rule-tab-panels');
  const prefix = 'lobby-rules-' + crypto.randomUUID();
  const buttons: HTMLButtonElement[] = [];
  const select = (index: number, focus = false) => {
    tabs.forEach((tab, i) => {
      tab.panel.hidden = i !== index;
      buttons[i].setAttribute('aria-selected', String(i === index));
      buttons[i].tabIndex = i === index ? 0 : -1;
    });
    changed(tabs[index].key);
    if (focus) buttons[index].focus();
  };
  tabs.forEach((tab, i) => {
    const button = h('button', tab.label);
    button.type = 'button';
    button.id = `${prefix}-${tab.key}`;
    button.dataset.actionKey = 'rules:tab:' + tab.key;
    button.dataset.ruleTab = tab.key;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-label', tab.label);
    button.setAttribute('aria-controls', button.id + '-panel');
    button.onclick = () => select(i);
    button.onkeydown = (event) => {
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowRight' ? (i + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : -1;
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      select(index, true);
    };
    buttons.push(button);
    nav.append(button);
    tab.panel.id = button.id + '-panel';
    tab.panel.classList.add('rule-tab-panel');
    tab.panel.dataset.ruleCategory = tab.key;
    tab.panel.setAttribute('role', 'tabpanel');
    tab.panel.setAttribute('aria-labelledby', button.id);
    panels.append(tab.panel);
  });
  root.append(nav, panels);
  select(Math.max(0, tabs.findIndex((tab) => tab.key === selected)));
  return root;
}
