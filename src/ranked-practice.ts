import { element as h } from './dom.ts';
import type { PolyModLoader } from './game-types.ts';

export interface PracticeTrack {
  id: string;
  discipline: 'fullspeed' | 'tech' | null;
}

interface NativeTrackCard {
  name: string;
  author?: string | null;
  element: HTMLElement;
}

class RankedPicker {
  #tab = h('button', 'Ranked tracks', 'button');
  #panel = h('div', undefined, 'tracks-container polycup-ranked-tracks');
  #groups: { element: HTMLElement; cards: NativeTrackCard[] }[] = [];
  #empty = h('div', undefined, 'empty');
  #input: HTMLInputElement;
  #cards: (ids: Set<string>) => Map<string, NativeTrackCard>;
  #select: () => void;

  constructor(
    root: HTMLElement,
    banner: string,
    input: HTMLInputElement,
    cards: (ids: Set<string>) => Map<string, NativeTrackCard>,
    select: () => void,
  ) {
    this.#input = input;
    this.#cards = cards;
    this.#select = select;
    const buttons = root.querySelector(':scope > .image-button-container')!;
    this.#tab.type = 'button';
    this.#tab.style.setProperty('--image-url', `url("${banner}")`);
    this.#tab.prepend(h('div', undefined, 'cover'));
    this.#tab.onclick = select;
    buttons.append(this.#tab);
    root.append(this.#panel);
    root.classList.add('has-ranked-tracks');
  }

  get active() { return this.#tab.classList.contains('selected'); }
  get mounted() { return this.#panel.isConnected; }

  show() {
    const root = this.#panel.parentElement!;
    for (const element of root.querySelectorAll(':scope > .image-button-container > .selected'))
      element.classList.remove('selected');
    for (const element of root.querySelectorAll(':scope > .tracks-container.open'))
      element.classList.remove('open');
    this.#tab.classList.add('selected');
    this.#panel.classList.add('open');
  }

  hide() {
    this.#tab.classList.remove('selected');
    this.#panel.classList.remove('open');
  }

  status(message: string, retry = false) {
    this.#groups = [];
    this.#empty.replaceChildren(h('div', message, 'description'));
    if (retry) {
      const button = h('button', 'Retry', 'button');
      button.type = 'button';
      button.onclick = this.#select;
      this.#empty.append(button);
    }
    this.#panel.replaceChildren(this.#empty);
  }

  render(pool: PracticeTrack[]) {
    const native = this.#cards(new Set(pool.map(track => track.id)));
    const tracks = [...new Map(pool.map(track => [track.id, track])).values()];
    const wrapper = h('div', undefined, 'wrapper');
    this.#groups = [];
    for (const [discipline, title] of [['fullspeed', 'Fullspeed'], ['tech', 'Tech'], [null, 'Other ranked tracks']] as const) {
      const cards = tracks.flatMap(track => {
        const card = native.get(track.id);
        return track.discipline === discipline && card ? [card] : [];
      });
      if (!cards.length) continue;
      const element = h('section');
      element.append(h('h2', title, 'group-title'), ...cards.map(card => card.element));
      this.#groups.push({ element, cards });
      wrapper.append(element);
    }
    if (!this.#groups.length) {
      this.status(pool.length ? 'Ranked tracks are unavailable in this game version.' : 'No active ranked track pool.');
      return;
    }
    const scroll = this.#panel.scrollTop;
    this.#empty.replaceChildren(h('div', 'No matching ranked tracks.', 'description'));
    this.#panel.replaceChildren(wrapper, this.#empty);
    this.search();
    this.#panel.scrollTop = scroll;
  }

  search() {
    if (!this.#groups.length) return;
    const query = this.#input.value.trim().toLowerCase();
    for (const { element, cards } of this.#groups) {
      for (const card of cards) {
        const shown = card.name.toLowerCase().includes(query) || card.author?.toLowerCase().includes(query);
        card.element.style.display = shown ? '' : 'none';
      }
      element.hidden = cards.every(card => card.element.style.display === 'none');
    }
    this.#empty.hidden = this.#groups.some(group => !group.element.hidden);
  }
}

export function rankedPracticeBridge(
  banner: string,
  fetchPool: () => Promise<PracticeTrack[]>,
  start: (ids: string[], pickerOpen: () => boolean) => Promise<void>,
) {
  const pickers = new WeakMap<object, RankedPicker>();
  let preferred = false;
  let cached: { tracks: PracticeTrack[]; at: number } | undefined;
  let pending: Promise<PracticeTrack[]> | undefined;
  const load = () => {
    if (cached && Date.now() - cached.at < 30_000) return Promise.resolve(cached.tracks);
    pending ??= fetchPool().then(tracks => {
      cached = { tracks, at: Date.now() };
      return tracks;
    }).finally(() => { pending = undefined; });
    return pending;
  };
  const open = (picker: RankedPicker) => {
    preferred = true;
    picker.show();
    if (!cached) picker.status('Loading ranked tracks…');
    void load().then(tracks => {
      if (picker.active && picker.mounted) picker.render(tracks);
    }, () => {
      if (picker.active && picker.mounted) picker.status('Could not load ranked tracks.', true);
    });
  };
  return {
    show(instance: object, root: HTMLElement, input: HTMLInputElement, cards: (ids: Set<string>) => Map<string, NativeTrackCard>, click: () => void) {
      if (!root.parentElement?.classList.contains('menu-ui')) return;
      let picker = pickers.get(instance);
      if (!picker) {
        const created = new RankedPicker(root, banner, input, cards, () => { click(); open(created); });
        pickers.set(instance, created);
        picker = created;
        const bar = root.querySelector(':scope > .bar')!;
        const button = h('button', undefined, 'button polycup-ranked-practice-button');
        const icon = h('img', undefined, 'button-icon');
        icon.src = 'images/play.svg';
        icon.alt = '';
        button.type = 'button';
        button.append(icon, document.createTextNode(' Ranked practice'));
        button.onclick = async () => {
          click();
          button.disabled = true;
          const pickerOpen = () => root.isConnected && !root.classList.contains('hidden');
          try {
            const tracks = await load();
            if (pickerOpen()) await start(tracks.map(track => track.id), pickerOpen);
          } catch (error) {
            if (!pickerOpen()) return;
            created.show();
            created.status(error instanceof Error ? error.message : 'Could not start ranked practice.', true);
          } finally { button.disabled = false; }
        };
        bar.insertBefore(button, bar.lastElementChild);
      }
      if (preferred) open(picker);
    },
    leave(instance: object) {
      const picker = pickers.get(instance);
      if (!picker?.active) return false;
      preferred = false;
      picker.hide();
      return true;
    },
    search(instance: object) {
      const picker = pickers.get(instance);
      if (!picker?.active) return false;
      picker.search();
      return true;
    },
    refresh(instance: object) {
      const picker = pickers.get(instance);
      if (picker?.active && cached) picker.render(cached.tracks);
    },
  };
}

export function registerRankedPractice(pml: PolyModLoader, insert: unknown) {
  if (pml.polyVersion !== '0.6.3') return;
  const bridge = 'window.polycupRuntime?.rankedPractice';
  const run = 'window.polycupRuntime?.rankedPracticeRun';
  const hook = (token: string, func: string) => pml.registerGlobalMixin({ type: insert, token, func });
  hook('(ae = function (e) {', `if(${bridge}?.leave(this)) queueMicrotask(()=>(0,i.gn)(this,A,"m",oe).call(this));`);
  hook('(oe = function () {', `if(${bridge}?.search(this)) return;`);
  hook('((0, i.gn)(this, U, "f").scrollTop = ve)));', `
    ${bridge}?.show(this,(0,i.gn)(this,C,"f"),(0,i.gn)(this,j,"f"),ids=>{
      const cards=new Map(),library=(0,i.gn)(this,S,"f");
      for(const category of ['official','community']){
        const collect=(id,group,metadata,environment,load,thumbnail)=>{
          if(!ids.has(id))return;
          const element=(0,i.gn)(this,A,"m",te).call(this,category,group,metadata,environment,()=>load().then(result=>result.trackData),id,thumbnail);
          // The ranked copies run their own search; leave the native search index unchanged.
          (0,i.gn)(this,H,"f").pop();
          cards.set(id,{name:metadata.name,author:metadata.author,element});
        };
        if(category==='official') library.forEachOfficialTrack(collect); else library.forEachCommunityTrack(collect);
      }
      return cards;
    },()=> (0,i.gn)(this,w,"f").playUIClick());`);
  hook('});\n                (0, i.gn)(this, A, "m", oe).call(this);', `${bridge}?.refresh(this);`);
  hook('ee = 0;', `
    let polycupRankedPracticeLaunch=false;
    ${run}?.bind({
      current:()=> $,
      available:()=>!o.isTransitioning&&!Za.get($)?.multiplayerConnection&&!document.body.dataset.polycupNativeRace,
      load:async id=>{
        let entry;
        x.forEachTrack((trackId,trackMetadata,category,environment,load)=>{
          if(trackId===id&&(category==='official'||category==='community'))entry={trackMetadata,category,load};
        });
        if(!entry)return null;
        const {trackData}=await entry.load();
        return trackData.getId()===id&&trackData.hasStartingPoint()?{trackData,trackMetadata:entry.trackMetadata,category:entry.category}:null;
      },
      launch:track=>{
        polycupRankedPracticeLaunch=true;
        document.body.dataset.polycupPractice='1';
        document.body.dataset.polycupPracticeOpenedAt=String(performance.now());
        try { J(track.trackMetadata,track.trackData,track.category,[],null,false); }
        finally { polycupRankedPracticeLaunch=false; }
      },
    });`);
  hook('K = (i, a) => {', `${run}?.cancel();`);
  hook('X = (e, t, n, i) => {', `${run}?.cancel();`);
  hook('J = (t, i, a, c, h, u) => {', `const rankedPractice=polycupRankedPracticeLaunch;if(!rankedPractice)${run}?.cancel();`);
  hook('                              }\n                            : null));', `if(rankedPractice) f=async token=>await ${run}?.skip($,token)??false;`);
  hook('                              !1,\n                            );\n                          },\n                        )),\n                        I.PM());', `
    if(rankedPractice){const game=$;${run}?.entered(game,()=>Xa.get(game)?.start());}`);
  hook('(Ss = function () {', `if(${run}?.discard(this)) return;`);
  hook('((e.up || e.down) &&\n                    ', `!${run}?.waiting(this) && `);
}
