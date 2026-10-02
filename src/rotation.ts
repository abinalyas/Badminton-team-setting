// Court rotation rules for a drop-in doubles session.
//
// - Players join a single first-come-first-served queue when they check in.
// - The first 4 in the queue go on court as soon as 4 people are present.
// - After each game the winners stay on (up to `maxConsecutive` games in a row)
//   and the losers go to the back of the queue. The next players in the queue
//   fill the empty spots.
// - Anyone who reaches `maxConsecutive` games in a row comes off, win or lose,
//   so the "winners stay" advantage works the same for every group, not just
//   the first one.

export interface Player {
  id: string;
  name: string;
  arrivedAt: number;
  gamesPlayed: number;
  wins: number;
  /** Games played in a row during the current stint on court. */
  streak: number;
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
  maxConsecutive: number;
  winnersStay: boolean;
  /** Usual pairs, by player name. Optional so older saved sessions still load. */
  pairs?: Array<[string, string]>;
  keepPairs?: boolean;
  /** The first four play games 1 and 2 together; game 2's winners stay for game 3. Default on. */
  openingFour?: boolean;
}

export interface SessionState {
  players: Record<string, Player>;
  /** Waiting players, front of the queue first. */
  queue: string[];
  court: Game | null;
  history: FinishedGame[];
  settings: Settings;
  /** Opening games left for the first four: 2 = game 1 on court, 1 = game 2 on court, 0/undefined = normal rotation. */
  opening?: number;
}

export const defaultSettings: Settings = { maxConsecutive: 2, winnersStay: true, pairs: [], keepPairs: true, openingFour: true };

export function newSession(settings: Settings = defaultSettings): SessionState {
  return { players: {}, queue: [], court: null, history: [], settings };
}

export function checkIn(state: SessionState, id: string, name: string, now: number): SessionState {
  if (state.players[id]) return state;
  const player: Player = { id, name, arrivedAt: now, gamesPlayed: 0, wins: 0, streak: 0 };
  return fillCourt({ ...state, players: { ...state.players, [id]: player }, queue: [...state.queue, id] }, now);
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

/** Starts a game with the first 4 in the queue if the court is free. */
export function fillCourt(state: SessionState, now: number): SessionState {
  if (state.court || state.queue.length < 4) return state;
  const four = state.queue.slice(0, 4);
  const [teamA, teamB] = makeTeams(state, four);
  const opening = state.history.length === 0 && state.settings.openingFour !== false ? 2 : 0;
  return { ...state, queue: state.queue.slice(4), court: { teamA, teamB, startedAt: now }, opening };
}

export function recordResult(state: SessionState, winner: "A" | "B", now: number): SessionState {
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

  // Opening game 1: the same four stay on for game 2, nobody from the queue comes on yet.
  if (state.opening === 2) {
    return { ...state, players, history, opening: 1, court: { ...game, startedAt: now } };
  }

  // Opening game 2: the winners always stay for game 3 against the next two, then come off.
  const openingGame2 = state.opening === 1;
  const winnersStay =
    state.settings.winnersStay &&
    (openingGame2 || winners.every((id) => players[id].streak < state.settings.maxConsecutive));
  const goingOff = winnersStay ? [...losers] : [...losers, ...winners];
  for (const id of goingOff) players[id] = { ...players[id], streak: 0 };
  if (winnersStay && openingGame2) {
    // They already played two, so game 3 is their last in a row.
    for (const id of winners) players[id] = { ...players[id], streak: Math.max(0, state.settings.maxConsecutive - 1) };
  }

  const queue = [...state.queue, ...goingOff];

  if (winnersStay) {
    // The losers just joined the queue, so there are always at least 2 challengers.
    const [c, d, ...rest] = queue;
    return {
      ...state,
      players,
      queue: rest,
      history,
      opening: 0,
      court: { teamA: winners, teamB: [c, d], startedAt: now },
    };
  }
  return fillCourt({ ...state, players, queue, history, opening: 0, court: null }, now);
}

/** 1-based position in the line to get on court, counting from the front of the queue. */
export function queuePosition(state: SessionState, id: string): number | null {
  const i = state.queue.indexOf(id);
  return i === -1 ? null : i + 1;
}
