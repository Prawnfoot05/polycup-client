import { element as h } from './dom.ts';
import { profilePicture } from './profile-picture.ts';
import type { TypingPlayer } from './typing.ts';
export const typingCSS = `.chat-typing{display:flex;align-items:center;gap:6px;min-height:24px;padding:2px 16px 6px;color:var(--pc-muted);font:400 16px/1.2 ForcedSquare,Arial,sans-serif;flex:none}.chat-typing:empty{display:none}.chat-typing .player-portrait{width:20px;height:20px;flex:0 0 20px;font-size:12px}.typing-names{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.typing-dots{display:inline-flex;gap:1px;align-self:center}.typing-dots span{display:inline-block;animation:typing-wave 3s ease-in-out infinite}.typing-dots span:nth-child(2){animation-delay:.12s}.typing-dots span:nth-child(3){animation-delay:.24s}@keyframes typing-wave{0%,36%,100%{transform:translateY(0);opacity:.65}12%{transform:translateY(-3px);opacity:1}}@media(prefers-reduced-motion:reduce){.typing-dots span{animation:none}}`;
export function drawTyping(element: HTMLElement, rows: readonly TypingPlayer[]) {
  element.replaceChildren();
  element.removeAttribute('aria-label');
  if (!rows.length) return;
  for (const row of rows.slice(0, 3))
    element.append(profilePicture(row.display_name, row.avatar_url));
  const names =
    rows
      .slice(0, 2)
      .map((p) => p.display_name)
      .join(' and ') + (rows.length > 2 ? ' and others' : '');
  element.append(
    h('span', names + (rows.length === 1 ? ' is typing' : ' are typing'), 'typing-names'),
  );
  const dots = h('span', undefined, 'typing-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) dots.append(h('span', '.'));
  element.append(dots);
  element.setAttribute('aria-label', names + ' typing');
}
