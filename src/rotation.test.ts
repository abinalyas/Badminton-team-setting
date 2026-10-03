import { describe, expect, it } from "vitest";
import {
  checkIn,
  comingOnCount,
  compromises,
  defaultSettings,
  leave,
  newSession,
  onCourt,
  awaitingFirstTeams,
  startFirstGame,
  pairUp,
  recordResult,
  type SessionState,
} from "./rotation";

function arrive(state: SessionState, ...names: string[]): SessionState {
  return names.reduce((s, n, i) => checkIn(s, n, n, i), state);
}

// Most tests run with the first game starting by itself; "first game teams" tests use the default.
const auto = { ...defaultSettings, manualFirstGame: false };
const noOpening = { ...auto, openingFour: false };
const sorted = (ids: string[]) => [...ids].sort();

describe("rotation", () => {
  it("waits until 4 players are present, then starts with the first 4", () => {
    let s = arrive(newSession(auto), "p1", "p2", "p3");
    expect(s.court).toBeNull();
    s = arrive(s, "p4", "p5");
    expect(sorted(onCourt(s))).toEqual(["p1", "p2", "p3", "p4"]);
    expect(s.queue).toEqual(["p5"]);
  });

  it("late arrivals join the back of the line", () => {
    let s = arrive(newSession(auto), "p1", "p2", "p3", "p4", "p5");
    s = checkIn(s, "late", "late", 100);
    expect(s.queue).toEqual(["p5", "late"]);
  });

  it("lets a waiting player leave", () => {
    let s = arrive(newSession(auto), "p1", "p2", "p3", "p4", "p5");
    s = leave(s, "p5");
    expect(s.queue).toEqual([]);
    expect(s.players.p5).toBeUndefined();
    expect(leave(s, "p1")).toBe(s); // on court, can't leave mid-game
  });

  it("with exactly 4 players everyone keeps playing", () => {
    let s = arrive(newSession(auto), "p1", "p2", "p3", "p4");
    for (let i = 0; i < 6; i++) {
      s = recordResult(s, i % 2 === 0 ? "A" : "B", i);
      expect(onCourt(s)).toHaveLength(4);
    }
  });

  describe("opening games and game 3", () => {
    const started = () => arrive(newSession(auto), "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8");

    it("the first four play two games against each other before anyone else comes on", () => {
      let s = started();
      const four = sorted(onCourt(s));
      s = recordResult(s, "A", 10);
      expect(sorted(onCourt(s))).toEqual(four);
      expect(s.queue).toEqual(["p5", "p6", "p7", "p8"]);
    });

    it("the winners of game 2 stay for game 3 against the next two; the losers go to the back", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      const winners = s.court!.teamB;
      const losers = s.court!.teamA;
      s = recordResult(s, "B", 20);
      expect(s.court!.teamA).toEqual(winners);
      expect(s.court!.teamB).toEqual(["p5", "p6"]);
      expect(s.queue).toEqual(["p7", "p8", ...losers]);
    });

    it("after game 3 only the game 2 winners come off; the team that just came on stays for its second game", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      const opening = s.court!.teamA;
      // The newcomers win game 3 or lose it: it makes no difference.
      for (const result of ["A", "B"] as const) {
        const after = recordResult(s, result, 30);
        expect(sorted(onCourt(after))).toEqual(sorted(["p5", "p6", "p7", "p8"]));
        expect(after.court!.teamA).toEqual(["p5", "p6"]);
        expect(after.court!.teamB).toEqual(["p7", "p8"]);
        expect(after.queue.slice(-2)).toEqual(opening);
      }
    });

    it("then each team plays two games in a row, win or lose, and comes off", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      s = recordResult(s, "A", 30); // game 3 done; p5/p6 stay and p7/p8 come on
      s = recordResult(s, "B", 40); // game 4: p5/p6 have played 2 -> off, p7/p8 stay
      expect(s.court!.teamA).toEqual(["p7", "p8"]);
      expect(onCourt(s)).not.toContain("p5");
      expect(onCourt(s)).not.toContain("p6");
      s = recordResult(s, "B", 50); // game 5: p7/p8 have played 2 -> off
      expect(onCourt(s)).not.toContain("p7");
      expect(onCourt(s)).not.toContain("p8");
    });

    it("the queue highlights who comes on next", () => {
      let s = started();
      expect(comingOnCount(s)).toBe(0); // game 1: same four play game 2
      s = recordResult(s, "A", 10);
      expect(comingOnCount(s)).toBe(2); // game 2: losers off, winners stay
      s = recordResult(s, "A", 20);
      expect(comingOnCount(s)).toBe(2); // game 3: only the opening winners come off
      s = recordResult(s, "A", 30);
      expect(comingOnCount(s)).toBe(2); // game 4: p5/p6 off
    });

    it("people who have played fewer games rejoin the queue ahead of those who played more", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      s = recordResult(s, "A", 30);
      s = recordResult(s, "A", 40); // p5/p6 (2 games) come off; queue is p2 p4 p1 p3 p5 p6 -> sorted by games
      expect(s.queue.slice(-2)).toEqual(["p5", "p6"].sort());
    });

    it("can be switched off: then both teams come off after their two games", () => {
      let s = arrive(newSession(noOpening), "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8");
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      expect(sorted(onCourt(s))).toEqual(["p5", "p6", "p7", "p8"]);
    });
  });

  describe("usual pairs", () => {
    const withPairs = (pairs: Array<[string, string]>) => newSession({ ...noOpening, pairs });

    it("puts usual partners on the same team even if they arrived apart", () => {
      const s = arrive(withPairs([["p1", "p4"]]), "p1", "p2", "p3", "p4");
      expect(s.court!.teamA).toEqual(["p1", "p4"]);
      expect(s.court!.teamB).toEqual(["p2", "p3"]);
      expect(compromises(s)).toEqual([]);
    });

    it("two pairs in the first four play each other", () => {
      const s = arrive(withPairs([["p1", "p3"], ["p2", "p4"]]), "p1", "p2", "p3", "p4");
      expect(s.court!.teamA).toEqual(["p1", "p3"]);
      expect(s.court!.teamB).toEqual(["p2", "p4"]);
    });

    it("never lets a pair jump the queue: a split pair compromises for that game", () => {
      // p4's partner p5 is 5th in line, so p4 plays with someone else this once.
      const s = arrive(withPairs([["p4", "p5"]]), "p1", "p2", "p3", "p4", "p5");
      expect(sorted(onCourt(s))).toEqual(["p1", "p2", "p3", "p4"]);
      expect(compromises(s)).toEqual(["p4"]);
      expect(s.queue).toEqual(["p5"]);
    });

    it("a pair stays together as a team", () => {
      let s = arrive(withPairs([["p1", "p2"]]), "p1", "p2", "p3", "p4", "p5", "p6");
      s = recordResult(s, "A", 10);
      expect(s.court!.teamA).toEqual(["p1", "p2"]);
    });

    it("can be switched off", () => {
      const s = arrive(
        newSession({ ...noOpening, pairs: [["p1", "p2"]], keepPairs: false }),
        "p1", "p2", "p3", "p4",
      );
      expect(s.court!.teamA).toEqual(["p1", "p3"]);
    });
  });

  describe("pairs who arrive at different times", () => {
    const withPairs = (pairs: Array<[string, string]>) => newSession({ ...noOpening, pairs });

    it("moves the early partner back to stand next to the late partner", () => {
      let s = arrive(withPairs([["S", "P"]]), "p1", "p2", "p3", "p4", "x1", "S", "x2", "x3", "P");
      expect(s.queue).toEqual(["x1", "x2", "x3", "S", "P"]);
      // Nobody who arrived before the late partner is bumped, and nobody jumps ahead of them.
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20); // both opening teams have played two games and come off
      // The pair takes the last two places, so x3 waits one game and goes first after that.
      expect(sorted(onCourt(s))).toEqual(sorted(["x1", "x2", "S", "P"]));
      expect(s.queue[0]).toBe("x3");
    });

    it("plays the pair as a team when their turn comes", () => {
      let s = arrive(withPairs([["S", "P"]]), "p1", "p2", "p3", "p4", "x1", "S", "x2", "P");
      expect(s.queue).toEqual(["x1", "x2", "S", "P"]);
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      const teams = [s.court!.teamA, s.court!.teamB].map(sorted);
      expect(teams).toContainEqual(["P", "S"]);
      expect(compromises(s)).toEqual([]);
    });

    it("works when the pair is added after both have already arrived", () => {
      let s = arrive(newSession(noOpening), "p1", "p2", "p3", "p4", "x1", "S", "x2", "x3", "P");
      expect(s.queue).toEqual(["x1", "S", "x2", "x3", "P"]);
      s = pairUp(s, "S", "P");
      expect(s.queue).toEqual(["x1", "x2", "x3", "S", "P"]);
      expect(s.settings.pairs).toEqual([["S", "P"]]);
    });

    it("doesn't move a partner who is already in the next group: they play now with someone else", () => {
      let s = arrive(withPairs([["S", "P"]]), "p1", "p2", "p3", "p4", "x1", "S", "x2", "x3", "x4");
      s = recordResult(s, "A", 10); // game 1 done: the next four after game 2 are x1 S x2 x3
      s = checkIn(s, "P", "P", 15); // P arrives late
      expect(s.queue).toEqual(["x1", "S", "x2", "x3", "x4", "P"]);
      s = recordResult(s, "A", 20);
      expect(sorted(onCourt(s))).toEqual(sorted(["x1", "S", "x2", "x3"]));
      expect(compromises(s)).toEqual(["S"]);
    });

    it("a pair is never split by the edge of a group: the single player before them waits one game", () => {
      // x1 would play next with S, but S & P are side by side, so S & P take the places and x1 waits.
      let s = arrive(newSession(auto), "p1", "p2", "p3", "p4", "x1", "S", "P", "x2");
      s = pairUp(s, "S", "P");
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20); // game 3: opening winners vs the next two
      expect(sorted(s.court!.teamB)).toEqual(["P", "S"]);
      expect(s.queue[0]).toBe("x1");
    });

    it("only one pair per player", () => {
      let s = arrive(newSession(noOpening), "p1", "p2", "p3", "p4", "S", "P", "Q");
      s = pairUp(s, "S", "P");
      expect(pairUp(s, "S", "Q")).toBe(s);
    });
  });

  describe("setting the first game's teams", () => {
    it("doesn't start by itself: it waits for the organiser to set the teams", () => {
      const s = arrive(newSession(), "a", "b", "c", "d", "e");
      expect(s.court).toBeNull();
      expect(awaitingFirstTeams(s)).toBe(true);
      expect(s.queue).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("starts the game with exactly the teams chosen, and the opening games follow", () => {
      let s = arrive(newSession(), "a", "b", "c", "d", "e", "f");
      s = startFirstGame(s, ["a", "d"], ["b", "c"], 100);
      expect(s.court!.teamA).toEqual(["a", "d"]);
      expect(s.court!.teamB).toEqual(["b", "c"]);
      expect(s.queue).toEqual(["e", "f"]);
      expect(s.opening).toBe(2);
      expect(awaitingFirstTeams(s)).toBe(false);
      // Game 2 is the same teams again, then the normal rotation takes over.
      s = recordResult(s, "A", 110);
      expect(s.court!.teamA).toEqual(["a", "d"]);
    });

    it("only accepts the first four in line, each once", () => {
      const s = arrive(newSession(), "a", "b", "c", "d", "e");
      expect(startFirstGame(s, ["a", "e"], ["b", "c"], 1)).toBe(s);
      expect(startFirstGame(s, ["a", "a"], ["b", "c"], 1)).toBe(s);
    });

    it("only the first game is set by hand; later games are made automatically", () => {
      let s = arrive(newSession(), "a", "b", "c", "d", "e", "f", "g", "h");
      s = startFirstGame(s, ["a", "b"], ["c", "d"], 1);
      s = recordResult(s, "A", 2);
      s = recordResult(s, "A", 3);
      s = recordResult(s, "A", 4); // game 3 finished: game 4 is set up without asking
      expect(s.court).not.toBeNull();
    });

    it("can be switched off", () => {
      const s = arrive(newSession({ ...defaultSettings, manualFirstGame: false }), "a", "b", "c", "d");
      expect(s.court).not.toBeNull();
    });
  });
});
