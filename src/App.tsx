import { useEffect, useState } from "react";
import {
  checkIn,
  compromises,
  defaultSettings,
  leave,
  newSession,
  recordResult,
  type SessionState,
  type Team,
} from "./rotation";

const SESSION_KEY = "bts.session";
const ROSTER_KEY = "bts.roster";
const MAX_UNDO = 30;
const OTHER = "__other__";

// The regular group (from the WhatsApp poll). New names added in the app are remembered too.
const DEFAULT_ROSTER = [
  "Abin",
  "Adith Jawahar",
  "Amal",
  "Amal 2",
  "Arundas",
  "Elson Puthencruz",
  "Jordan",
  "Nikhil",
  "Paulo",
  "Renjith",
  "Sivan Chettan",
  "Sreekanth Mech",
];

function mergeRoster(extra: string[]): string[] {
  const seen = new Set<string>();
  return [...DEFAULT_ROSTER, ...extra]
    .filter((n) => !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode); the app still works for this visit.
  }
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Sessions saved before the rules changed keep their players but get the current default rules.
function migrate(saved: SessionState): SessionState {
  if (saved.settings.rulesVersion === defaultSettings.rulesVersion) return saved;
  return {
    ...saved,
    settings: {
      ...saved.settings,
      winnersStay: defaultSettings.winnersStay,
      maxConsecutive: defaultSettings.maxConsecutive,
      rulesVersion: defaultSettings.rulesVersion,
    },
  };
}

export default function App() {
  const [state, setState] = useState<SessionState>(() => migrate(load(SESSION_KEY, newSession())));
  const [undoStack, setUndoStack] = useState<SessionState[]>([]);
  const [roster, setRoster] = useState<string[]>(() => mergeRoster(load<string[]>(ROSTER_KEY, [])));
  const [choice, setChoice] = useState("");
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");
  const [name, setName] = useState("");

  useEffect(() => save(SESSION_KEY, state), [state]);
  useEffect(() => save(ROSTER_KEY, roster), [roster]);

  function update(next: SessionState) {
    if (next === state) return;
    setUndoStack((u) => [...u.slice(-(MAX_UNDO - 1)), state]);
    setState(next);
  }

  function undo() {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((u) => u.slice(0, -1));
    setState(prev);
  }

  const presentNames = new Set(Object.values(state.players).map((p) => p.name.toLowerCase()));

  function addPlayer(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || presentNames.has(trimmed.toLowerCase())) return;
    update(checkIn(state, crypto.randomUUID(), trimmed, Date.now()));
    setRoster(mergeRoster([...roster, trimmed]));
    setName("");
    setChoice("");
  }

  const pairs = state.settings.pairs ?? [];
  const inPair = (n: string) => pairs.some(([x, y]) => x === n || y === n);

  function addPair() {
    if (!pairA || !pairB || pairA === pairB || inPair(pairA) || inPair(pairB)) return;
    update({ ...state, settings: { ...state.settings, pairs: [...pairs, [pairA, pairB]] } });
    setPairA("");
    setPairB("");
  }

  function removePair(i: number) {
    update({ ...state, settings: { ...state.settings, pairs: pairs.filter((_, j) => j !== i) } });
  }

  function startNewSession() {
    if (!confirm("End this session and clear the queue? Saved player names are kept.")) return;
    update(newSession(state.settings));
  }

  const playerName = (id: string) => state.players[id]?.name ?? "?";
  const teamLabel = (team: Team) => team.map(playerName).join(" & ");
  const notHere = roster.filter((r) => !presentNames.has(r.toLowerCase()));
  const present = Object.values(state.players);
  const compromising = compromises(state);
  // How many people from the front of the queue go on after the current game.
  const comingOnCount = !state.court ? 4 : state.opening === 2 ? 0 : state.opening === 1 || state.settings.winnersStay ? 2 : 4;
  const needed = 4 - present.length;

  return (
    <main>
      <header>
        <h1>Court Queue</h1>
        <button className="ghost" onClick={undo} disabled={undoStack.length === 0}>
          Undo
        </button>
      </header>

      <section className="card court">
        <h2>On court</h2>
        {state.court ? (
          <>
            <div className="teams">
              <TeamBox label="Team A" team={state.court.teamA} state={state} />
              <span className="vs">vs</span>
              <TeamBox label="Team B" team={state.court.teamB} state={state} />
            </div>
            {state.opening ? (
              <p className="notice">
                {state.opening === 2
                  ? "Opening game 1 of 2: the first four play each other twice."
                  : "Opening game 2 of 2: the winners stay on for game 3 against the next two."}
              </p>
            ) : null}
            {compromising.length > 0 && (
              <p className="notice">
                {compromising.map(playerName).join(" & ")} {compromising.length === 1 ? "is" : "are"} not with{" "}
                {compromising.length === 1 ? "their" : "a"} usual partner this game, to keep the queue fair.
              </p>
            )}
            <p className="muted">Who won?</p>
            <div className="row">
              <button onClick={() => update(recordResult(state, "A", Date.now()))}>
                {teamLabel(state.court.teamA)}
              </button>
              <button onClick={() => update(recordResult(state, "B", Date.now()))}>
                {teamLabel(state.court.teamB)}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">
            {needed > 0
              ? `Waiting for ${needed} more player${needed === 1 ? "" : "s"} to start.`
              : "Ready to start."}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Check in</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            addPlayer(choice === OTHER ? name : choice);
          }}
        >
          <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Player">
            <option value="">Select player…</option>
            {notHere.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value={OTHER}>Someone else…</option>
          </select>
          <button type="submit" disabled={!choice || (choice === OTHER && !name.trim())}>
            Add
          </button>
        </form>
        {choice === OTHER && (
          <div className="row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New player name"
              aria-label="New player name"
              autoFocus
            />
          </div>
        )}
        {notHere.length === 0 && <p className="muted small">Everyone on the list is checked in.</p>}
      </section>

      <section className="card">
        <h2>Up next ({state.queue.length} waiting)</h2>
        {state.queue.length === 0 ? (
          <p className="muted">Nobody waiting.</p>
        ) : (
          <ol className="queue">
            {state.queue.map((id, i) => {
              const p = state.players[id];
              const comingOn = i < comingOnCount;
              return (
                <li key={id} className={comingOn ? "next" : ""}>
                  <span className="pos">{i + 1}</span>
                  <span className="name">{p.name}</span>
                  <span className="muted small">
                    {p.gamesPlayed} game{p.gamesPlayed === 1 ? "" : "s"} · in {formatTime(p.arrivedAt)}
                  </span>
                  <button className="ghost small" onClick={() => update(leave(state, id))} aria-label={`${p.name} left`}>
                    Left
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {present.length > 0 && (
        <section className="card">
          <h2>Today</h2>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Games</th>
                <th>Wins</th>
              </tr>
            </thead>
            <tbody>
              {[...present]
                .sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.arrivedAt - b.arrivedAt)
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.gamesPlayed}</td>
                    <td>{p.wins}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="muted small">{state.history.length} game{state.history.length === 1 ? "" : "s"} played this session.</p>
        </section>
      )}

      <section className="card">
        <h2>Usual pairs</h2>
        {pairs.length === 0 ? (
          <p className="muted small">
            Pairs who like to play together. They're put on the same team when both are in the next game. Nobody
            skips the line: if only one of them is up, they play with someone else for that game.
          </p>
        ) : (
          <ul className="pairs">
            {pairs.map(([x, y], i) => (
              <li key={`${x}-${y}`}>
                <span>
                  {x} & {y}
                </span>
                <button className="ghost small" onClick={() => removePair(i)} aria-label={`Remove pair ${x} and ${y}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <select value={pairA} onChange={(e) => setPairA(e.target.value)} aria-label="First partner">
            <option value="">Player…</option>
            {roster.filter((r) => !inPair(r) && r !== pairB).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={pairB} onChange={(e) => setPairB(e.target.value)} aria-label="Second partner">
            <option value="">Partner…</option>
            {roster.filter((r) => !inPair(r) && r !== pairA).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button onClick={addPair} disabled={!pairA || !pairB}>
            Add pair
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Rules</h2>
        <label className="row between">
          <span>Winners keep playing (optional)</span>
          <input
            type="checkbox"
            checked={state.settings.winnersStay}
            onChange={(e) => update({ ...state, settings: { ...state.settings, winnersStay: e.target.checked } })}
          />
        </label>
        <label className="row between">
          <span>First four play two games together</span>
          <input
            type="checkbox"
            checked={state.settings.openingFour !== false}
            onChange={(e) => update({ ...state, settings: { ...state.settings, openingFour: e.target.checked } })}
          />
        </label>
        <label className="row between">
          <span>Keep usual pairs together</span>
          <input
            type="checkbox"
            checked={state.settings.keepPairs !== false}
            onChange={(e) => update({ ...state, settings: { ...state.settings, keepPairs: e.target.checked } })}
          />
        </label>
        <label className="row between">
          <span>Max games in a row</span>
          <select
            value={state.settings.maxConsecutive}
            disabled={!state.settings.winnersStay}
            onChange={(e) =>
              update({ ...state, settings: { ...state.settings, maxConsecutive: Number(e.target.value) } })
            }
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          The first four play two games, and the game 2 winners stay on for game 3. After that, all four come off
          after every game and the next four in line go on, so winning only matters for game 3. Turn on "winners
          keep playing" if you want winners to stay on (up to {state.settings.maxConsecutive} in a row).
        </p>
        <div className="row">
          <button className="ghost" onClick={startNewSession}>
            New session
          </button>
          {(state.settings.winnersStay !== defaultSettings.winnersStay ||
            state.settings.maxConsecutive !== defaultSettings.maxConsecutive ||
            state.settings.keepPairs === false ||
            state.settings.openingFour === false) && (
            <button
              className="ghost"
              onClick={() => update({ ...state, settings: { ...defaultSettings, pairs: state.settings.pairs } })}
            >
              Reset rules
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function TeamBox({ label, team, state }: { label: string; team: Team; state: SessionState }) {
  return (
    <div className="team">
      <span className="muted small">{label}</span>
      {team.map((id) => {
        const p = state.players[id];
        return (
          <strong key={id}>
            {p.name}
            {state.settings.winnersStay && p.streak > 0 && (
              <span className="streak">
                {" "}
                · game {p.streak + 1}/{state.settings.maxConsecutive}
              </span>
            )}
          </strong>
        );
      })}
    </div>
  );
}
