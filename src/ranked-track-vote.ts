import type { RankedTrackVote } from './ranked.ts';
import type { LibraryTrack } from './game-types.ts';
import { protectUITouches } from './touch-ui.ts';
import theme from './interface-theme.css';
import css from './ranked-track-vote.css';
import { tracks as seasonTracks } from '../supabase/catalogs/season-1.json';
import { profilePicture, profilePictureCSS } from './profile-picture.ts';
import { statusIcon } from './status-icon.ts';

export class RankedTrackVoteUI {
  #root = document.createElement('div');
  #shadow = this.#root.attachShadow({ mode: 'open' });
  #dialog = document.createElement('dialog');
  #cards = new Map<
    string,
    {
      button: HTMLButtonElement;
      voters: HTMLElement;
      label: HTMLElement;
      stamp: HTMLElement;
      voterKey: string;
    }
  >();
  #clock = document.createElement('span');
  #error = document.createElement('p');
  #key = '';
  #vote?: RankedTrackVote;
  #offset = 0;
  #serverStamp = '';
  #people: { id: string; name: string; avatar_url?: string | null }[] = [];
  #revealStart = 0;
  #revealDuration = 0;
  #stamped = false;
  #animationChoices: string[] = [];
  #timer?: ReturnType<typeof setInterval>;
  #reveal?: ReturnType<typeof setTimeout>;
  #revealed = '';
  #pending = false;
  #self = '';
  #submit?: (track: string) => Promise<void>;
  constructor() {
    this.#root.id = 'polycup-track-vote';
    document.body.append(this.#root);
    const style = document.createElement('style');
    style.textContent = theme + profilePictureCSS + css;
    this.#dialog.setAttribute('aria-labelledby', 'track-vote-title');
    this.#dialog.addEventListener('cancel', (event) => event.preventDefault());
    this.#shadow.append(style, this.#dialog);
    protectUITouches(this.#shadow);
  }
  ready(match: string, vote: RankedTrackVote) {
    return vote.phase === 'closed' && this.#revealed === match + ':' + vote.winner;
  }
  show(
    match: string,
    vote: RankedTrackVote,
    self: string,
    serverTime: string | undefined,
    tracks: LibraryTrack[],
    people: { id: string; name: string; avatar_url?: string | null }[],
    submit: (track: string) => Promise<void>,
    done: () => void,
  ) {
    this.#vote = vote;
    this.#self = self;
    this.#submit = submit;
    this.#people = people;
    if (serverTime && serverTime !== this.#serverStamp) {
      const at = Date.parse(serverTime);
      if (Number.isFinite(at)) {
        this.#offset = at - Date.now();
        this.#serverStamp = serverTime;
      }
    }
    const key = match + ':' + vote.candidates.map((t) => t.id).join(',');
    if (key !== this.#key) {
      this.hide();
      this.#key = key;
      this.#cards.clear();
      this.#revealed = '';
      this.#pending = false;
      this.#stamped = false;
      const header = document.createElement('header'),
        title = document.createElement('h1');
      title.id = 'track-vote-title';
      title.textContent = 'Choose a track';
      this.#clock = document.createElement('span');
      this.#clock.className = 'vote-clock';
      header.append(title, this.#clock);
      const grid = document.createElement('div');
      grid.className = 'vote-cards';
      for (const candidate of vote.candidates) {
        const track = tracks.find((t) => t.id === candidate.id),
          meta = seasonTracks.find((t) => t.id === candidate.id);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'track-choice';
        button.dataset.track = candidate.id;
        const art = document.createElement('div');
        art.className = 'vote-art';
        const image = document.createElement('img');
        image.alt = '';
        image.decoding = 'async';
        image.hidden = true;
        art.append(image);
        const stamp = document.createElement('span');
        stamp.className = 'vote-stamp';
        stamp.setAttribute('aria-hidden', 'true');
        stamp.append(statusIcon('check'));
        art.append(stamp);
        if (track?.thumbnail)
          void Promise.resolve(track.thumbnail)
            .then((url) => {
              if (!url) return;
              image.onload = () => {
                image.hidden = false;
              };
              image.onerror = () => image.remove();
              image.src = url;
            })
            .catch(() => {});
        const caption = document.createElement('div');
        caption.className = 'vote-caption';
        const discipline = document.createElement('small');
        discipline.textContent =
          meta?.discipline === 'fullspeed'
            ? 'Fullspeed'
            : meta?.discipline === 'tech'
              ? 'Tech'
              : candidate.category === 'official'
                ? 'Main track'
                : 'Community track';
        const name = document.createElement('h2');
        name.textContent = track?.name || meta?.name || 'Ranked track';
        caption.append(discipline, name);
        const voters = document.createElement('span'),
          label = document.createElement('span');
        voters.className = 'vote-voters';
        label.className = 'vote-your-choice';
        caption.append(label);
        button.append(art, caption, voters);
        button.addEventListener('click', () => void this.choose(candidate.id));
        this.#cards.set(candidate.id, { button, voters, label, stamp, voterKey: '' });
        grid.append(button);
      }
      this.#error = document.createElement('p');
      this.#error.className = 'vote-error';
      this.#error.setAttribute('role', 'alert');
      this.#error.hidden = true;
      this.#dialog.replaceChildren(header, grid, this.#error);
    }
    this.paint();
    if (!this.#dialog.open) this.#dialog.showModal();
    if (!this.#timer) this.#timer = setInterval(() => this.tick(), 100);
    if (vote.phase === 'closed' && !this.#reveal && !this.ready(match, vote)) {
      this.#animationChoices = vote.eligible?.length
        ? vote.eligible
        : Object.values(vote.ballots).length
          ? [...new Set(Object.values(vote.ballots))]
          : vote.candidates.map((c) => c.id);
      this.#revealDuration =
        this.#animationChoices.length > 1 &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 1450
          : 0;
      this.#revealStart = Number.isFinite(Date.parse(vote.closed_at ?? ''))
        ? Date.parse(vote.closed_at!)
        : Date.now() + this.#offset;
      this.#dialog.querySelector('h1')!.textContent = this.#revealDuration
        ? 'Choosing track…'
        : 'Track selected';
      const remaining = Math.max(
        0,
        this.#revealStart + this.#revealDuration + 650 - Date.now() - this.#offset,
      );
      this.#reveal = setTimeout(() => {
        this.#reveal = undefined;
        this.#revealed = match + ':' + vote.winner;
        done();
      }, remaining);
      this.tick();
    }
  }
  private async choose(track: string) {
    if (
      this.#pending ||
      !this.#vote ||
      this.#vote.phase !== 'open' ||
      Date.now() + this.#offset >= Date.parse(this.#vote.ends_at)
    )
      return;
    this.#pending = true;
    this.#error.hidden = true;
    this.paint();
    const key = this.#key;
    try {
      await this.#submit?.(track);
    } catch (error) {
      if (this.#key === key) {
        this.#error.textContent =
          error instanceof Error ? error.message : 'Could not vote. Try again.';
        this.#error.hidden = false;
      }
    } finally {
      if (this.#key === key) {
        this.#pending = false;
        this.paint();
      }
    }
  }
  private tick() {
    if (!this.#vote) return;
    const left = Math.max(
      0,
      Math.ceil((Date.parse(this.#vote.ends_at) - Date.now() - this.#offset) / 1000),
    );
    this.#clock.textContent = this.#vote.phase === 'closed' ? '' : left ? left + 's' : 'Choosing…';
    if (this.#vote.phase === 'closed') {
      const elapsed = Date.now() + this.#offset - this.#revealStart;
      this.#stamped = elapsed >= this.#revealDuration;
      if (this.#stamped) this.#dialog.querySelector('h1')!.textContent = 'Track selected';
      const steps = [0, 80, 180, 310, 480, 690, 940, 1220],
        index = Math.max(0, steps.filter((t) => t <= elapsed).length - 1);
      for (const [id, card] of this.#cards)
        card.button.classList.toggle(
          'is-rolling',
          !this.#stamped && this.#animationChoices[index % this.#animationChoices.length] === id,
        );
    }
    this.paintCards();
  }
  private paintCards() {
    if (!this.#vote) return;
    const selected = this.#vote.ballots[this.#self];
    for (const [id, card] of this.#cards) {
      const voterIds = Object.entries(this.#vote.ballots)
        .filter(([, track]) => track === id)
        .map(([player]) => player);
      const voterKey = voterIds
        .map((id) => id + ':' + this.#people.find((p) => p.id === id)?.avatar_url)
        .join(',');
      if (voterKey !== card.voterKey) {
        card.voterKey = voterKey;
        card.voters.replaceChildren();
        for (const player of voterIds) {
          const person = this.#people.find((p) => p.id === player),
            portrait = profilePicture(person?.name ?? 'Player', person?.avatar_url);
          portrait.dataset.player = player;
          card.voters.append(portrait);
        }
        card.voters.setAttribute(
          'aria-label',
          voterIds.length + ' ' + (voterIds.length === 1 ? 'vote' : 'votes'),
        );
      }
      const winner = this.#vote.phase === 'closed' && this.#stamped && this.#vote.winner === id;
      card.label.textContent = winner ? 'Selected' : selected === id ? 'Your vote' : '';
      card.button.classList.toggle('is-selected', this.#vote.phase === 'open' && selected === id);
      card.button.classList.toggle('is-winner', winner);
      card.button.classList.toggle(
        'is-other',
        this.#vote.phase === 'closed' && this.#stamped && !winner,
      );
      card.stamp.classList.toggle('is-stamped', winner);
      card.button.setAttribute('aria-pressed', String(selected === id));
      card.button.disabled =
        this.#pending ||
        this.#vote.phase === 'closed' ||
        Date.now() + this.#offset >= Date.parse(this.#vote.ends_at);
      card.button.setAttribute('aria-busy', String(this.#pending));
    }
  }
  private paint() {
    this.tick();
  }
  hide() {
    this.#dialog.close();
    clearInterval(this.#timer);
    this.#timer = undefined;
    clearTimeout(this.#reveal);
    this.#reveal = undefined;
  }
}
