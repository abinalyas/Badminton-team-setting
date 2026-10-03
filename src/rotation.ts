// Court rotation rules for a drop-in doubles session.
//
// - Players join a single first-come-first-served queue when they check in.
// - The first 4 in the queue go on court as soon as 4 people are present, and play
//   `maxConsecutive` games against each other (the opening games).
// - The winners of the last opening game stay for one more game against the next 2 in the
//   queue. This is the only place where winning matters.
// - After that every team plays `maxConsecutive` games in a row, win or lose, then comes off.
//   A team that has just come on stays for its second game, and the next 2 in the queue
//   challenge it. So after game 3 only the opening winners come off.
// - People coming off rejoin the queue; whoever has played fewer games goes first.

export interface Player {
  id: string;
  name: string;
  arrivedAt: number;
  gamesPlayed: number;
  wins: number;
  /** Games played in a row during the current stint on court. */
  streak: number;
  /** Games allowed in the current stint on court. Defaults to `maxConsecutive`; +1 for the opening winners. */
  limit?: number;
}

export type Team = [string, string];

export interface Game {
  teamA: Team;
  teamB: Team;
  startedAt: number;
}

export interface FinishedGame extends Game {
  winner: "A" | "B";
  finishedAt: number;
}

export interface Settings {
  /** Games each team plays in a row before coming off, and the number of opening games. */
  maxConsecutive: number;
  /** Usual pairs, by player name. Optional so older saved sessions still load. */
  pairs?: Array<[string, string]>;
  keepPairs?: boolean;
  /** The first four play the opening games together; the last one's winners stay for one more. Default on. */
  openingFour?: boolean;
  /** The organiser picks the first game's teams instead of the app. Default on. */
  manualFirstGame?: boolean;
  /** Bumped when default rules change, so saved sessions can be migrated. */
  rulesVersion?: number;
}

export interface SessionState {
  players: Record<string, Player>;
  /** Waiting players, front of the queue first. */
  queue: string[];
  court: Game | null;
  history: FinishedGame[];
  settings: Settings;
  /** Opening games left for the first four, including the one on court. 0/undefined = normal rotation. */
  opening?: number;
}

export const defaultSettings: Settings = {
  maxConsecutive: 2,
  pairs: [],
  keepPairs: true,
  openingFour: true,
  manualFirstGame: true,
  rulesVersion: 3,
};

export function newSession(settings: Settings = defaultSettings): SessionState {
  return { players: {}, queue: [], court: null, history: [], settings };
}

export function checkIn(state: SessionState, id: string, name: string, now: number): SessionState {
  if (state.players[id]) return state;
  const player: Player = { id, name, arrivedAt: now, gamesPlayed: 0, wins: 0, streak: 0 };
  const joined = { ...state, players: { ...state.players, [id]: player }, queue: [...state.queue, id] };
  return keepPairsTogether(fillCourt(joined, now));
}

/** Removes a waiting player (e.g. they went home). Players on court can't leave mid-game. */
export function leave(state: SessionState, id: string): SessionState {
  if (!state.queue.includes(id)) return state;
  const { [id]: _removed, ...players } = state.players;
  return { ...state, players, queue: state.queue.filter((q) => q !== id) };
}

export function onCourt(state: SessionState): string[] {
  return state.court ? [...state.court.teamA, ...state.court.teamB] : [];
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The usual partner of a checked-in player, if that partner is also checked in. */
export function partnerOf(state: SessionState, id: string): string | undefined {
  if (state.settings.keepPairs === false) return undefined;
  const me = state.players[id];
  if (!me) return undefined;
  for (const [x, y] of state.settings.pairs ?? []) {
    const other = sameName(x, me.name) ? y : sameName(y, me.name) ? x : null;
    if (other === null) continue;
    return Object.values(state.players).find((p) => sameName(p.name, other))?.id;
  }
  return undefined;
}

/**
 * Splits 4 players into two teams. The first 4 in the queue always play (so arrival order is
 * fair); usual partners are put on the same team whenever both are in the group.
 */
function makeTeams(state: SessionState, four: string[]): [Team, Team] {
  const pairs: Team[] = [];
  const used = new Set<string>();
  for (const id of four) {
    const partner = partnerOf(state, id);
    if (used.has(id) || !partner || !four.includes(partner)) continue;
    pairs.push([id, partner]);
    used.add(id).add(partner);
  }
  if (pairs.length >= 2) return [pairs[0], pairs[1]];
  if (pairs.length === 1) {
    const rest = four.filter((id) => !used.has(id)) as Team;
    return [pairs[0], rest];
  }
  // No pairs: the 1st goes with the 3rd and the 2nd with the 4th so the earliest arrivals
  // aren't always partners.
  return [[four[0], four[2]], [four[1], four[3]]];
}

/** Players on court whose usual partner is checked in but playing on the other team. */
export function compromises(state: SessionState): string[] {
  const game = state.court;
  if (!game) return [];
  return onCourt(state).filter((id) => {
    const partner = partnerOf(state, id);
    if (!partner) return false;
    const team = game.teamA.includes(id) ? game.teamA : game.teamB;
    return !team.includes(partner);
  });
}

/**
 * Takes the next `size` players from the front of `queue`. Partners who are side by side in the
 * queue count as one unit, so a pair is never split by the edge of a group: if a pair would
 * straddle it, the single player just before them waits one more game instead.
 */
function pickGroup(state: SessionState, queue: string[], size: number): { group: string[]; rest: string[] } {
  const units: string[][] = [];
  for (let i = 0; i < queue.length; ) {
    const partner = partnerOf(state, queue[i]);
    if (partner && queue[i + 1] === partner) {
      units.push([queue[i], partner]);
      i += 2;
    } else {
      units.push([queue[i]]);
      i += 1;
    }
  }
  const picked: string[][] = [];
  const count = () => picked.reduce((n, u) => n + u.length, 0);
  for (const unit of units) {
    if (count() >= size) break;
    if (unit.length <= size - count()) {
      picked.push(unit);
      continue;
    }
    // A pair needs 2 places but only 1 is left: it takes the place of the last single picked.
    const lastSingle = picked.map((u) => u.length).lastIndexOf(1);
    if (lastSingle !== -1) {
      picked.splice(lastSingle, 1);
      picked.push(unit);
    }
  }
  const group = picked.flat();
  return { group, rest: queue.filter((id) => !group.includes(id)) };
}

/**
 * Lines usual partners up in the queue so they can play together. If the earlier partner is
 * still waiting, they move back to stand next to the later partner, so the pair plays when the
 * later partner's turn comes and nobody who arrived before that partner is bumped. A partner who
 * is already in the next group isn't moved: they play now, with someone else if need be.
 */
export function keepPairsTogether(state: SessionState): SessionState {
  if (state.settings.keepPairs === false || !state.court) return state;
  const protectedCount = comingOnCount(state);
  let queue = state.queue;
  for (const id of state.queue) {
    const partner = partnerOf(state, id);
    if (!partner) continue;
    const a = queue.indexOf(id);
    const b = queue.indexOf(partner);
    if (a === -1 || b === -1 || Math.abs(a - b) === 1) continue;
    const [early, late] = a < b ? [a, b] : [b, a];
    if (early < protectedCount) continue;
    const without = queue.filter((_, i) => i !== early);
    without.splice(late - 1, 0, queue[early]);
    queue = without;
  }
  return queue === state.queue ? state : { ...state, queue };
}

/** Makes two players a usual pair, and lines them up in the queue if both are waiting. */
export function pairUp(state: SessionState, a: string, b: string): SessionState {
  const pairs = state.settings.pairs ?? [];
  const taken = (n: string) => pairs.some(([x, y]) => sameName(x, n) || sameName(y, n));
  if (sameName(a, b) || taken(a) || taken(b)) return state;
  return keepPairsTogether({ ...state, settings: { ...state.settings, pairs: [...pairs, [a, b]] } });
}

/** True while 4 or more people are here but the organiser hasn't set the first game's teams yet. */
export function awaitingFirstTeams(state: SessionState): boolean {
  return !state.court && state.queue.length >= 4 && state.history.length === 0 && state.settings.manualFirstGame !== false;
}

/** The first 4 in line, who play the first game. */
export function firstFour(state: SessionState): string[] {
  return state.queue.slice(0, 4);
}

const openingGames = (state: SessionState) =>
  state.history.length === 0 && state.settings.openingFour !== false ? state.settings.maxConsecutive : 0;

/** Starts a game with the first 4 in the queue if the court is free (the first game waits for the organiser). */
export function fillCourt(state: SessionState, now: number): SessionState {
  if (state.court || state.queue.length < 4 || awaitingFirstTeams(state)) return state;
  const { group: four, rest } = pickGroup(state, state.queue, 4);
  const [teamA, teamB] = makeTeams(state, four);
  return { ...state, queue: rest, court: { teamA, teamB, startedAt: now }, opening: openingGames(state) };
}

/** Starts the first game with teams the organiser chose. Both teams must be made of the first 4 in line. */
export function startFirstGame(state: SessionState, teamA: Team, teamB: Team, now: number): SessionState {
  if (!awaitingFirstTeams(state)) return state;
  const chosen = [...teamA, ...teamB];
  const four = firstFour(state);
  if (new Set(chosen).size !== 4 || !chosen.every((id) => four.includes(id))) return state;
  return {
    ...state,
    queue: state.queue.filter((id) => !chosen.includes(id)),
    court: { teamA, teamB, startedAt: now },
    opening: openingGames(state),
  };
}

export function recordResult(state: SessionState, winner: "A" | "B", now: number): SessionState {
  return keepPairsTogether(recordGame(state, winner, now));
}

function recordGame(state: SessionState, winner: "A" | "B", now: number): SessionState {
  const game = state.court;
  if (!game) return state;
  const winners = winner === "A" ? game.teamA : game.teamB;
  const losers = winner === "A" ? game.teamB : game.teamA;

  const players = { ...state.players };
  for (const id of [...winners, ...losers]) {
    const p = players[id];
    players[id] = {
      ...p,
      gamesPlayed: p.gamesPlayed + 1,
      wins: p.wins + (winners.includes(id) ? 1 : 0),
      streak: p.streak + 1,
    };
  }

  const history = [...state.history, { ...game, winner, finishedAt: now }];

  const max = state.settings.maxConsecutive;

  // Opening games: the same four stay on, nobody from the queue comes on yet.
  if ((state.opening ?? 0) > 1) {
    return { ...state, players, history, opening: (state.opening ?? 0) - 1, court: { ...game, startedAt: now } };
  }

  // A team stays while everyone on it still has games left in their stint. The winners of the last
  // opening game are the one exception: they get one extra game (limit + 1) against the next two.
  const lastOpening = state.opening === 1;
  if (lastOpening) {
    for (const id of winners) players[id] = { ...players[id], limit: max + 1 };
  }
  const stays = (team: Team) => team.every((id) => players[id].streak < (players[id].limit ?? max));
  const staying = lastOpening ? [winners] : ([game.teamA, game.teamB] as Team[]).filter(stays);
  const leaving = onCourt(state).filter((id) => !staying.some((team) => team.includes(id)));

  // Everyone coming off rejoins the queue; whoever has played fewer games goes first.
  leaving.sort((a, b) => players[a].gamesPlayed - players[b].gamesPlayed);
  for (const id of leaving) players[id] = { ...players[id], streak: 0, limit: undefined };
  const queue = [...state.queue, ...leaving];
  const next = { ...state, players, history, opening: 0 };

  if (staying.length === 2) {
    return { ...next, queue, court: { ...game, startedAt: now } };
  }
  if (staying.length === 1) {
    // The leaving team just joined the queue, so there are always at least 2 challengers.
    const { group, rest } = pickGroup(state, queue, 2);
    return { ...next, queue: rest, court: { teamA: staying[0], teamB: [group[0], group[1]], startedAt: now } };
  }
  return fillCourt({ ...next, queue, court: null }, now);
}

/** How many people from the front of the queue go on after the current game finishes. */
export function comingOnCount(state: SessionState): number {
  const game = state.court;
  if (!game) return 4;
  if ((state.opening ?? 0) > 1) return 0;
  if (state.opening === 1) return 2;
  const max = state.settings.maxConsecutive;
  const leavingTeams = ([game.teamA, game.teamB] as Team[]).filter(
    (team) => !team.every((id) => state.players[id].streak + 1 < (state.players[id].limit ?? max)),
  );
  return leavingTeams.length * 2;
}

/** 1-based position in the line to get on court, counting from the front of the queue. */
export function queuePosition(state: SessionState, id: string): number | null {
  const i = state.queue.indexOf(id);
  return i === -1 ? null : i + 1;
}
