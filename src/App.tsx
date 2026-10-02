import { useEffect, useState } from "react";
import {
  checkIn,
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

export default function App() {
  const [state, setState] = useState<SessionState>(() => load(SESSION_KEY, newSession()));
  const [undoStack, setUndoStack] = useState<SessionState[]>([]);
  const [roster, setRoster] = useState<string[]>(() => load(ROSTER_KEY, []));
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
    if (!roster.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
      setRoster([...roster, trimmed].sort((a, b) => a.localeCompare(b)));
    }
    setName("");
  }

  function startNewSession() {
    if (!confirm("End this session and clear the queue? Saved player names are kept.")) return;
    update(newSession(state.settings));
  }

  const playerName = (id: string) => state.players[id]?.name ?? "?";
  const teamLabel = (team: Team) => team.map(playerName).join(" & ");
  const notHere = roster.filter((r) => !presentNames.has(r.toLowerCase()));
  const present = Object.values(state.players);
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
            addPlayer(name);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Player name"
            aria-label="Player name"
          />
          <button type="submit" disabled={!name.trim()}>
            Add
          </button>
        </form>
        {notHere.length > 0 && (
          <>
            <p className="muted small">Tap a regular as they arrive:</p>
            <div className="chips">
              {notHere.map((r) => (
                <button key={r} className="chip" onClick={() => addPlayer(r)}>
                  + {r}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Up next ({state.queue.length} waiting)</h2>
        {state.queue.length === 0 ? (
          <p className="muted">Nobody waiting.</p>
        ) : (
          <ol className="queue">
            {state.queue.map((id, i) => {
              const p = state.players[id];
              const comingOn = state.court ? i < 2 : i < 4;
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
        <h2>Rules</h2>
        <label className="row between">
          <span>Winners stay on</span>
          <input
            type="checkbox"
            checked={state.settings.winnersStay}
            onChange={(e) => update({ ...state, settings: { ...state.settings, winnersStay: e.target.checked } })}
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
          Losers go to the back of the line. Winners stay until they've played{" "}
          {state.settings.maxConsecutive} in a row, then they come off too, so every group gets the same
          chance.
        </p>
        <div className="row">
          <button className="ghost" onClick={startNewSession}>
            New session
          </button>
          {(state.settings.winnersStay !== defaultSettings.winnersStay ||
            state.settings.maxConsecutive !== defaultSettings.maxConsecutive) && (
            <button className="ghost" onClick={() => update({ ...state, settings: defaultSettings })}>
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
