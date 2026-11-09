// A small, solid family for the social rail. Search and copy follow the
// native game's silhouettes; the remaining shapes share their 24px grid.
const paths = {
  folder: 'M2 4h8l2 3h10v14H2zm2 5v10h16V9z',
  edit: 'M4 16 15 5l4 4L8 20l-5 1zm13-13 1-1a2 2 0 0 1 3 3l-1 1z',
  copy: 'M21 6H6v15h15zM3 19V3h16v2H5v14z',
  messages: 'M2 3h20v15H8l-6 5zm3 3v11l2-2h12V6zm3 2h8v2H8zm0 4h6v2H8z',
  friends:
    'M9 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm7 1a3.5 3.5 0 0 1 0 7h-1a6 6 0 0 0 0-7zM2 21v-3a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v3zm15-9h1a4 4 0 0 1 4 4v5h-4v-3a8 8 0 0 0-1-6z',
  requests: 'M10 2h4v2a6 6 0 0 1 4 6v5l3 3v2H3v-2l3-3v-5a6 6 0 0 1 4-6zm0 20h4v2h-4z',
  search:
    'M21.172 24l-7.387-7.387A9 9 0 1 1 16.613 13.785L24 21.172zM9 16a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  lobby: 'M4 2h3v2h14l-3 5 3 5H7v8H4z',
  lock: 'M6 10V7a6 6 0 0 1 12 0v3h2v12H4V10zm3 0h6V7a3 3 0 0 0-6 0zm2 4v4h2v-4z',
  check: 'M5 12l4 4L19 6',
  close: 'M6 6l12 12M6 18 18 6',
} as const;

export type SocialIcon = keyof typeof paths;

export function socialIcon(name: SocialIcon): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.dataset.icon = name;
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', paths[name]);
  if (name === 'check' || name === 'close') {
    shape.setAttribute('fill', 'none');
    shape.setAttribute('stroke', 'currentColor');
    shape.setAttribute('stroke-width', '2.5');
    shape.setAttribute('stroke-linecap', 'square');
    shape.setAttribute('stroke-linejoin', 'miter');
  } else {
    shape.setAttribute('fill', 'currentColor');
    shape.setAttribute('fill-rule', 'evenodd');
  }
  icon.append(shape);
  return icon;
}
