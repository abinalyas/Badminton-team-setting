import { describe, expect, it } from "vitest";
import {
  checkIn,
  compromises,
  defaultSettings,
  leave,
  newSession,
  onCourt,
  recordResult,
  type SessionState,
} from "./rotation";

function arrive(state: SessionState, ...names: string[]): SessionState {
  return names.reduce((s, n, i) => checkIn(s, n, n, i), state);
}

// "Classic" = the optional winners-stay rule with no opening games, to test that rule on its own.
const noOpening = { ...defaultSettings, openingFour: false, winnersStay: true };
const normal = () => newSession(noOpening);

describe("rotation", () => {
  it("waits until 4 players are present, then starts with the first 4", () => {
    let s = arrive(normal(), "p1", "p2", "p3");
    expect(s.court).toBeNull();
    s = arrive(s, "p4", "p5");
    expect(onCourt(s).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(s.queue).toEqual(["p5"]);
  });

  it("winners stay, losers go to the back, next two in the queue come on", () => {
    let s = arrive(normal(), "p1", "p2", "p3", "p4", "p5", "p6", "p7");
    const winners = s.court!.teamA;
    const losers = s.court!.teamB;
    s = recordResult(s, "A", 10);
    expect(s.court!.teamA).toEqual(winners);
    expect(s.court!.teamB).toEqual(["p5", "p6"]);
    expect(s.queue).toEqual(["p7", ...losers]);
  });

  it("winners come off after the max consecutive games, so every group gets the same advantage", () => {
    let s = arrive(normal(), "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10");
    const first = s.court!.teamA;
    s = recordResult(s, "A", 10); // first team wins game 1, stays
    s = recordResult(s, "A", 20); // first team wins game 2 -> reached the cap
    expect(onCourt(s)).not.toContain(first[0]);
    expect(s.queue.slice(-2)).toEqual(first);

    // A later group that wins twice in a row gets exactly the same treatment.
    const later = s.court!.teamB;
    s = recordResult(s, "B", 30);
    expect(s.court!.teamA).toEqual(later);
    s = recordResult(s, "A", 40);
    expect(onCourt(s)).not.toContain(later[0]);
  });

  it("with exactly 4 players everyone keeps playing", () => {
    let s = arrive(normal(), "p1", "p2", "p3", "p4");
    for (let i = 0; i < 5; i++) {
      s = recordResult(s, "A", i);
      expect(onCourt(s)).toHaveLength(4);
    }
    expect(Object.values(s.players).every((p) => p.gamesPlayed === 5)).toBe(true);
  });

  it("late arrivals join the back of the line", () => {
    let s = arrive(normal(), "p1", "p2", "p3", "p4", "p5");
    s = checkIn(s, "late", "late", 100);
    s = recordResult(s, "A", 110);
    expect(s.court!.teamB).toEqual(["p5", "late"]);
  });

  it("can turn off winners-stay so all four come off every game", () => {
    let s = arrive(newSession({ ...noOpening, winnersStay: false }), "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8");
    s = recordResult(s, "A", 10);
    expect(onCourt(s).sort()).toEqual(["p5", "p6", "p7", "p8"]);
  });

  it("lets a waiting player leave", () => {
    let s = arrive(normal(), "p1", "p2", "p3", "p4", "p5");
    s = leave(s, "p5");
    expect(s.queue).toEqual([]);
    expect(s.players.p5).toBeUndefined();
    expect(leave(s, "p1")).toBe(s); // on court, can't leave mid-game
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
      expect(onCourt(s).sort()).toEqual(["p1", "p2", "p3", "p4"]);
      expect(compromises(s)).toEqual(["p4"]);
      expect(s.queue).toEqual(["p5"]);
    });

    it("a winning pair stays together as a team", () => {
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

  describe("opening four", () => {
    const started = () => arrive(newSession(), "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8");

    it("the first four play game 2 together before anyone else comes on", () => {
      let s = started();
      const four = onCourt(s).sort();
      s = recordResult(s, "A", 10);
      expect(onCourt(s).sort()).toEqual(four);
      expect(s.queue).toEqual(["p5", "p6", "p7", "p8"]);
    });

    it("the winners of game 2 stay for game 3 against the next two", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      const winners = s.court!.teamB; // game 2 winners
      s = recordResult(s, "B", 20);
      expect(s.court!.teamA).toEqual(winners);
      expect(s.court!.teamB).toEqual(["p5", "p6"]);
      expect(s.queue.slice(0, 2)).toEqual(["p7", "p8"]);
    });

    it("the opening winners come off after game 3, then normal rules apply", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      const opening = s.court!.teamA;
      s = recordResult(s, "A", 30); // opening winners win game 3 too, but come off
      expect(onCourt(s)).not.toContain(opening[0]);
      expect(s.queue.slice(-2)).toEqual(opening);
      expect(s.opening).toBe(0);
    });

    it("after game 3 winning no longer matters: all four come off and the next four go on", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      s = recordResult(s, "B", 30); // p5 & p6 beat the opening winners in game 3
      expect(onCourt(s)).not.toContain("p5");
      expect(onCourt(s)).not.toContain("p6");
      expect(onCourt(s)).toContain("p7");
      expect(onCourt(s)).toContain("p8");
    });

    it("people who have played fewer games rejoin the queue ahead of those who played more", () => {
      let s = started();
      s = recordResult(s, "A", 10);
      s = recordResult(s, "A", 20);
      s = recordResult(s, "B", 30);
      // p5/p6 played 1 game, the opening four played 3 -> p5/p6 are first back in line.
      expect(s.queue.slice(0, 2).sort()).toEqual(["p5", "p6"]);
    });

    it("with only four players, games just keep going", () => {
      let s = arrive(newSession(), "p1", "p2", "p3", "p4");
      for (let i = 0; i < 4; i++) {
        s = recordResult(s, "A", i);
        expect(onCourt(s)).toHaveLength(4);
      }
    });

    it("can be switched off", () => {
      let s = arrive(newSession(noOpening), "p1", "p2", "p3", "p4", "p5", "p6");
      s = recordResult(s, "A", 10);
      expect(s.court!.teamB).toEqual(["p5", "p6"]);
    });
  });
});
