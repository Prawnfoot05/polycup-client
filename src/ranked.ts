import type { SupabaseClient } from '@supabase/supabase-js';
import { isAccountId } from './account-id.ts';
import { standardPreset, type CupPreset, type CupRules } from './presets.ts';

export type RankTier =
  | 'provisional'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'grandmaster';
export type RankedStatus =
  | 'reserved'
  | 'drafting'
  | 'racing'
  | 'review'
  | 'disputed'
  | 'completed'
  | 'cancelled'
  | 'unrated';
export interface LeaderboardEntry {
  avatar_url?: string;
  player_id: string;
  display_name: string;
  rating: number;
  rated_matches: number;
  leaderboard_position: number;
  tier: Exclude<RankTier, 'provisional'>;
  gm_position: number | null;
}
export interface RankedProfile extends Omit<LeaderboardEntry, 'tier' | 'leaderboard_position'> {
  tier: RankTier;
  provisional: boolean;
  leaderboard_position: number | null;
}
export interface RankedStats {
  current_win_streak?: number;
  best_rewarded_streak?: number;
  matches: number;
  wins: number;
  win_rate: number | null;
}
export type LeaderboardSort = 'rating' | 'matches' | 'wins' | 'win_rate' | 'name' | 'level';
export interface TrackDirectoryEntry {
  track_id: string;
  name: string;
  category: string;
  season_id: string;
  players: number;
  best_time: number | null;
  own_time: number | null;
  own_position: number | null;
}
export interface TrackRecordLeader {
  player_id: string;
  display_name: string;
  avatar_url: string | null;
  records: number;
  position: number;
}
export interface TrackRecordEntry {
  player_id: string;
  display_name: string;
  avatar_url: string | null;
  time_ms: number;
  match_id: string;
  achieved_at: string;
  position: number;
  row_index: number;
}
export interface TrackBoard {
  entries: TrackRecordEntry[];
  focus: TrackRecordEntry | null;
  total: number;
  best_time: number | null;
}
export interface StandingEntry extends LeaderboardEntry {
  level?: number;
  wins: number;
  win_rate: number;
  friend_position: number;
  sort_position: number;
}
export interface ProfileHighlights extends RankedStats {
  season: { id: string; name: string } | null;
  peak_rating: number | null;
  podiums: number;
  average_place: number | null;
  best_win_streak: number;
  rank_progress: {
    floor: number;
    next_floor: number | null;
    next_tier: string | null;
    required: number;
    played: number;
  } | null;
  track_performance: {
    track_id: string;
    matches: number;
    wins: number;
    win_rate: number;
    last_played: string;
  }[];
  recent_opponents: {
    player_id: string;
    display_name: string;
    avatar_url: string;
    matches: number;
    wins: number;
    win_rate: number;
    last_played: string;
  }[];
  rating_history: {
    match_id?: string;
    participants?: {
      player_id: string;
      display_name: string;
      avatar_url: string | null;
      place: number | null;
    }[];
    rating: number;
    tier: RankTier;
    gm_position_at_start?: number | null;
    place: number | null;
    players: number;
    at: string;
    change: number | null;
  }[];
}
export interface InputReview {
  match_id: string;
  player_id: string;
  round: number;
  track: string;
  status:
    | 'flagged'
    | 'no_match'
    | 'partial'
    | 'pending'
    | 'unavailable'
    | 'no_reference'
    | 'unsupported'
    | 'invalid';
  policy: string | null;
  corpus: string | null;
  findings: {
    reference: string;
    referenceRank: number;
    kind: 'whole' | 'segment';
    start: number;
    end: number;
    referenceStart: number;
    referenceEnd: number;
    transitions: number;
    coverage: number;
  }[];
}
export interface RankedHistoryEntry {
  time_ms?: number | null;
  match_id: string;
  finished_at: string;
  place: number;
  rating_before: number | null;
  rating_after: number;
  model_version: string;
  player_count: number;
  rounds: number;
  /** Present from polycup_ranked_history_v2; older backends omit them. */
  track_id?: string | null;
  tier?: RankTier | null;
  gm_position_at_start?: number | null;
  opponents?: {
    player_id: string;
    display_name: string;
    avatar_url?: string | null;
    place: number | null;
  }[];
}
export interface RankedMatchResult {
  track_id?: string | null;
  season?: { id: string; name: string } | null;
  match_id: string;
  finished_at: string;
  rounds: number;
  players: {
    rank?: Pick<RankedProfile, 'tier' | 'rating' | 'gm_position' | 'provisional'> | null;
    avatar_url?: string;
    abandoned?: boolean;
    time_ms?: number | null;
    dnf?: boolean;
    xp_gained?: number;
    xp_before?: number;
    xp_after?: number;
    unlocks?: import('./reward-reveal.ts').RewardUnlock[];
    win_streak?: number;
    streak_before?: number;
    streak_bonus?: number;
    base_gain?: number;
    player_id: string;
    display_name: string;
    place: number | null;
    rating_before: number | null;
    rating_after: number | null;
  }[];
}
export interface CasualHistoryEntry {
  match_id: string;
  title: string;
  mode: 'ffa' | 'teams';
  finished_at: string;
  rounds: number;
  player_count: number;
  place: number;
}
export interface CasualMatchResult extends Omit<CasualHistoryEntry, 'place' | 'player_count'> {
  players: {
    player_id: string | null;
    display_name: string;
    avatar_url?: string;
    team?: 'blue' | 'red';
    place: number;
    score: number;
  }[];
}
export interface RankedQueueInfo {
  enabled: boolean;
  version: string;
  waiting: number;
  three_after: number;
  two_after: number;
}
export interface RankedQueueSnapshot extends RankedQueueInfo {
  state: 'idle' | 'queued' | 'matched';
  compatible_waiting?: number;
  search_reason?: 'waiting_for_players' | 'rating_range' | 'waiting_for_group';
  joined_at?: string | null;
  server_time?: string;
  match?: {
    id: string;
    status: RankedStatus;
    deadline: string;
    self: string;
    rules: CupRules;
    can_leave: boolean;
    reconnect_until?: string | null;
    abandoned?: boolean;
    left?: boolean;
    host_disconnected?: boolean;
    is_host?: boolean;
    can_reconnect?: boolean;
    result_submitted?: boolean;
    players: { id: string; name: string; accepted: boolean; online: boolean }[];
  };
}
export type QueueAction = 'join' | 'poll' | 'cancel' | 'accept' | 'decline' | 'leave-match';
export interface RankedDraft {
  bans: { player_id: string; track_id: string }[];
  picks: { player_id: string; track_id: string }[];
}
export interface RankedMatch {
  id: string;
  status: RankedStatus;
  rules: CupRules & {
    version: number;
    minPlayers: number;
    maxPlayers: number;
    targetPlayers: number;
  };
  roster: string[];
  host_id: string;
  track_pool: { id: string; category: 'official' | 'community'; digest: string }[];
  draft: RankedDraft | null;
  deadline: string;
  reason: string | null;
  accepted: string[];
}
export interface RankedEvidence {
  /** Digest of the canonical match transcript, checked later by a trusted validator. */
  digest: string;
  rounds: number;
  standings: { player_id: string; place: number; points: number }[];
}

/** Ranked UI uses an allowlist. There is no special host override. */
export function rankedLobbyControls(status: RankedStatus) {
  return {
    friends: true,
    chat: true,
    viewRules: true,
    draft: status === 'drafting',
    accept: status === 'reserved',
    decline: status === 'reserved',
    invite: false,
    roomCode: false,
    visibility: false,
    editPreset: false,
    manageRacers: false,
    returnToLobby: false,
    changeTrack: false,
    editScores: false,
    hostStart: false,
    hostEnd: false,
  } as const;
}

/** Preview only. The server's versioned match snapshot is authoritative. */
export function rankedPreset(): CupPreset {
  const preset = standardPreset();
  preset.name = 'Ranked';
  // Ranked retains its server-versioned FFA rules contract.
  delete preset.rules.mode;
  Object.assign(preset.rules, {
    singleTrack: true,
    singleRound: true,
    finalist: false,
    selection: 'random',
    roundsPerTrack: 1,
    pointsToWin: 10,
    points: [10, 7, 4, 2, 0, 0, 0, 0],
    bansPerRacer: 0,
    picksPerRacer: 0,
    warmup: 'off',
    warmupTiming: 'fixed',
    warmupSeconds: 30,
    readyEndsWarmup: false,
    roundBreakSeconds: 3,
  });
  return preset;
}

/** Text layout contract for the supplied PNGs; no rank thresholds in the client. */
export function rankBadgeText(
  profile: Pick<RankedProfile, 'tier' | 'rating' | 'gm_position' | 'provisional'>,
): {
  primary: string;
  secondary: string | null;
} {
  return { primary: String(profile.rating), secondary: null };
}

/** No polling or network traffic until a caller explicitly uses a method.
 * Deliberately excludes reservation, advancement and rating-write APIs.
 */
export class Ranked {
  constructor(private client: SupabaseClient) {}
  #inputPolicy?: Promise<boolean>;
  #picturesUnavailable = false;
  #pictureCache = new Map<string, { url: string; at: number }>();
  async pictures(players: string[]): Promise<Record<string, string>> {
    if (this.#picturesUnavailable || !players.length) return {};
    const result: Record<string, string> = {},
      missing: string[] = [];
    for (const id of [...new Set(players)].filter(isAccountId).slice(0, 100)) {
      const old = this.#pictureCache.get(id);
      if (old && Date.now() - old.at < 60000) result[id] = old.url;
      else missing.push(id);
    }
    if (!missing.length) return result;
    try {
      const { data, error } = await this.client
        .rpc('polycup_profile_pictures', { player_keys: missing })
        .abortSignal(AbortSignal.timeout(2000));
      if (error) throw error;
      for (const id of missing) {
        const url = typeof data?.[id] === 'string' ? data[id] : '';
        result[id] = url;
        this.#pictureCache.set(id, { url, at: Date.now() });
      }
      if (this.#pictureCache.size > 300)
        for (const id of [...this.#pictureCache.keys()].slice(0, this.#pictureCache.size - 300))
          this.#pictureCache.delete(id);
      return result;
    } catch (e) {
      if (['PGRST202', '42883'].includes((e as { code?: string }).code ?? ''))
        this.#picturesUnavailable = true;
      return result; // A failed optional image request must not hide the leaderboard.
    }
  }
  inputReviewEnabled(): Promise<boolean> {
    return (this.#inputPolicy ??= this.rpc<boolean>('polycup_input_review_policy').catch((e) => {
      if (['PGRST202', '42883'].includes(e.code)) return false;
      this.#inputPolicy = undefined;
      throw e;
    }));
  }
  async inputReview(
    matches: string[],
    player: string | null = null,
  ): Promise<InputReview[] | null> {
    if (!(await this.inputReviewEnabled())) return null;
    return this.rpc('polycup_input_review', { match_keys: matches, player_key: player });
  }
  submitInputRun(
    match: string,
    instance: string,
    run: import('./ranked-inputs.ts').InputRun,
  ): Promise<boolean> {
    return this.rpc('polycup_submit_input_run', { match_key: match, instance_key: instance, run });
  }
  saveGarageSnapshot(
    match: string,
    instance: string,
    profile: { name: string; country?: string | null; style?: string },
  ): Promise<boolean> {
    return this.rpc('polycup_ranked_garage_snapshot', {
      match_key: match,
      instance_key: instance,
      profile,
    });
  }
  submitReplayRun(
    match: string,
    instance: string,
    run: import('./ranked-inputs.ts').InputRun,
  ): Promise<boolean> {
    return this.rpc('polycup_submit_replay_run', { match_key: match, instance_key: instance, run });
  }
  reportReplayIssue(match: string, instance: string, round: number, state: string): Promise<void> {
    return this.rpc('polycup_replay_issue', {
      match_key: match,
      instance_key: instance,
      round_key: round,
      state_key: state,
    });
  }
  #staticSnapshot?: {
    key: string;
    pool: import('./ranked-room.ts').RankedSession['pool'];
    rules: import('./ranked-room.ts').RankedSession['rules'];
  };
  #legacySession = false;

  private async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client
      .rpc(name, args)
      .abortSignal(AbortSignal.timeout(12000));
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as T;
  }

  async leaderboard(pageSize = 50, pageOffset = 0): Promise<LeaderboardEntry[]> {
    const rows = await this.rpc<LeaderboardEntry[]>('polycup_leaderboard', {
      page_size: pageSize,
      page_offset: pageOffset,
    });
    const pictures = await this.pictures(rows.map((r) => r.player_id));
    return rows.map((r) => ({ ...r, avatar_url: pictures[r.player_id] }));
  }
  standings(
    season: string | null,
    friends: boolean,
    sort: LeaderboardSort = 'rating',
    direction: 'asc' | 'desc' = 'desc',
    pageSize = 25,
    pageOffset = 0,
  ): Promise<StandingEntry[]> {
    return this.rpc('polycup_standings', {
      season_key: season,
      friends_only: friends,
      sort_stat: sort,
      sort_direction: direction,
      page_size: pageSize,
      page_offset: pageOffset,
    });
  }
  trackDirectory(season: string | null = null, friends = false): Promise<TrackDirectoryEntry[]> {
    return this.rpc('polycup_track_directory', { season_key: season, friends_only: friends });
  }
  trackRecordLeaders(season: string | null = null): Promise<TrackRecordLeader[]> {
    return this.rpc('polycup_track_record_leaders', { season_key: season });
  }
  trackBoard(
    track: string,
    season: string | null = null,
    friends = false,
    player: string | null = null,
    offset = 0,
  ): Promise<TrackBoard> {
    return this.rpc('polycup_track_leaderboard', {
      track_key: track,
      season_key: season,
      friends_only: friends,
      player_key: player,
      page_size: 25,
      page_offset: offset,
    });
  }
  seasons(): Promise<{ id: string; name: string; active: boolean }[]> {
    return this.rpc('polycup_seasons');
  }
  onlineCount(): Promise<number> {
    return this.rpc('polycup_online_count');
  }
  async seasonLeaderboard(
    season: string,
    friends: boolean,
    pageSize = 50,
    pageOffset = 0,
  ): Promise<(LeaderboardEntry & { friend_position: number })[]> {
    const rows = await this.rpc<(LeaderboardEntry & { friend_position: number })[]>(
      'polycup_season_leaderboard',
      {
        season_key: season,
        friends_only: friends,
        page_size: pageSize,
        page_offset: pageOffset,
      },
    );
    const pictures = await this.pictures(rows.map((r) => r.player_id));
    return rows.map((r) => ({ ...r, avatar_url: pictures[r.player_id] }));
  }

  async profile(playerId: string): Promise<RankedProfile | null> {
    const rows = await this.rpc<RankedProfile[]>('polycup_ranked_profile', {
      player_key: playerId,
    });
    return rows[0] ?? null;
  }

  stats(playerId: string): Promise<RankedStats> {
    return this.rpc('polycup_ranked_stats', { player_key: playerId });
  }

  async friendsLeaderboard(
    pageSize = 50,
    pageOffset = 0,
  ): Promise<(LeaderboardEntry & { friend_position: number })[]> {
    const rows = await this.rpc<(LeaderboardEntry & { friend_position: number })[]>(
      'polycup_friends_leaderboard',
      {
        page_size: pageSize,
        page_offset: pageOffset,
      },
    );
    const pictures = await this.pictures(rows.map((r) => r.player_id));
    return rows.map((r) => ({ ...r, avatar_url: pictures[r.player_id] }));
  }
  async history(
    playerId: string,
    pageSize = 20,
    pageOffset = 0,
    season: string | null = null,
  ): Promise<RankedHistoryEntry[]> {
    return this.rpc('polycup_ranked_history_season', {
      player_key: playerId,
      page_size: pageSize,
      page_offset: pageOffset,
      season_key: season,
    });
  }
  casualHistory(player: string, size = 20, offset = 0) {
    return this.rpc<CasualHistoryEntry[]>('polycup_casual_history', {
      player_key: player,
      page_size: size,
      page_offset: offset,
    });
  }
  casualResult(match: string) {
    return this.rpc<CasualMatchResult>('polycup_casual_result', { match_key: match });
  }

  async session(
    match: string,
    instance: string,
    action: string,
    value: unknown = null,
  ): Promise<import('./ranked-room.ts').RankedSession | null> {
    const args = {
      match_key: match,
      instance_key: instance,
      action,
      value,
    };
    if (this.#legacySession) return this.rpc('polycup_ranked_session', args);
    // Capture the cache used by this request: a concurrent response may replace
    // the latest catalog while this one is in flight.
    const cached = this.#staticSnapshot;
    type Session = import('./ranked-room.ts').RankedSession;
    let raw:
      | (Omit<Session, 'pool' | 'rules'> &
          Partial<Pick<Session, 'pool' | 'rules'>> & { static_key: string })
      | null;
    try {
      raw = await this.rpc('polycup_ranked_session_v2', {
        ...args,
        known_static_key: cached?.key ?? null,
      });
    } catch (error) {
      // Missing-function errors guarantee that no action ran. Never replay an
      // action after a timeout or an ambiguous transport failure.
      if (!['PGRST202', '42883'].includes((error as { code?: string }).code ?? '')) throw error;
      this.#legacySession = true;
      return this.rpc('polycup_ranked_session', args);
    }
    if (raw === null) return null;
    if (raw.pool && raw.rules) {
      this.#staticSnapshot = structuredClone({
        key: raw.static_key,
        pool: raw.pool,
        rules: raw.rules,
      });
      return raw as Session;
    }
    if (!cached || cached.key !== raw.static_key)
      throw new Error('Ranked track catalog is unavailable. Reopen the Cup to refresh it.');
    return { ...raw, ...structuredClone({ pool: cached.pool, rules: cached.rules }) } as Session;
  }
  sessionBind(match: string, instance: string, value: object): Promise<number> {
    return this.rpc('polycup_ranked_session', {
      match_key: match,
      instance_key: instance,
      action: 'bind',
      value,
    });
  }
  current(): Promise<string | null> {
    return this.rpc('polycup_ranked_current');
  }
  abandon(match: string, instance: string): Promise<void> {
    return this.rpc('polycup_ranked_abandon', { match_key: match, instance_key: instance });
  }
  submitResult(
    match: string,
    instance: string,
    transcript: import('./ranked-transcript.ts').RankedTranscript,
  ): Promise<string> {
    return this.rpc('polycup_ranked_submit', {
      match_key: match,
      instance_key: instance,
      transcript,
    });
  }
  resultStatus(match: string): Promise<{ status: RankedStatus; reason: string | null }> {
    return this.rpc('polycup_ranked_result_status', { match_key: match });
  }
  claimResult(owner: string, match: string | null = null): Promise<string | null> {
    return this.rpc('polycup_ranked_claim_result', { delivery_key: owner, match_key: match });
  }
  seenResult(match: string): Promise<void> {
    return this.rpc('polycup_ranked_seen_result', { match_key: match });
  }
  rejectResult(match: string, instance: string): Promise<void> {
    return this.rpc('polycup_ranked_reject_result', { match_key: match, instance_key: instance });
  }
  queueInfo(): Promise<RankedQueueInfo> {
    return this.rpc('polycup_queue_info');
  }
  queue(action: QueueAction, instance: string, version: string): Promise<RankedQueueSnapshot> {
    return this.rpc('polycup_queue', { action, instance_key: instance, client_version: version });
  }

  async match(matchId: string): Promise<RankedMatchResult | null> {
    const result = await this.rpc<RankedMatchResult | null>('polycup_ranked_match', {
      match_key: matchId,
    });
    if (!result) return null;
    const pictures = await this.pictures(result.players.map((p) => p.player_id));
    return {
      ...result,
      players: result.players.map((p) => ({ ...p, avatar_url: pictures[p.player_id] })),
    };
  }

  async replay(
    matchId: string,
    recordings = false,
    round: number | null = null,
  ): Promise<import('./match-replay.ts').MatchReplay | null> {
    try {
      return await this.rpc('polycup_match_replay', {
        match_key: matchId,
        include_recordings: recordings,
        round_key: round,
      });
    } catch (e) {
      if (['PGRST202', '42883'].includes((e as { code?: string }).code ?? '')) return null;
      throw e;
    }
  }

  member(
    matchId: string,
    instanceId: string,
    action: 'poll' | 'accept' | 'withdraw' = 'poll',
  ): Promise<RankedMatch> {
    return this.rpc('polycup_ranked_member', {
      match_key: matchId,
      instance_key: instanceId,
      action,
    });
  }

  report(matchId: string, instanceId: string, evidence: RankedEvidence): Promise<RankedStatus> {
    return this.rpc('polycup_ranked_report', {
      match_key: matchId,
      instance_key: instanceId,
      evidence,
    });
  }
}
