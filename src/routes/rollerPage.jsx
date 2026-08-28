/**
 * Very temporary table-roller page — a real pass at this is planned later on
 * this branch. Lists the roller tables the server discovered from
 * server/data/*.txt (tracked in rollerTableMetadata) and rolls a random entry
 * from whichever one is selected. The server decides how much of the result
 * a viewer gets: a regular user's popup shows only the number rolled, while
 * the DM's popup also shows the rolled row's text — same redaction shape as
 * the tracker's hidden enemy stats, just enforced by what the ack contains.
 * The DM additionally sees a live history of the last 20 rolls from anyone.
 */
import {useEffect, useState} from "react";
import {commands, useConnected, useDmStatus, useSocketEvent} from "../helpers/socket.js";
import ConnectionStatus from "../helpers/connectionStatus.jsx";
import DmAccess from "../helpers/dmAccess.jsx";

export default function RollerPage() {
  const connected = useConnected();
  const [isDm, setIsDm] = useDmStatus();
  const [tables, setTables] = useState([]);
  const [selected, setSelected] = useState("");
  const [rolling, setRolling] = useState(false);
  // Mirrors the server's 1-roll-per-second rate limit so the button reflects
  // the cooldown instead of just surfacing a rejection from the next click.
  const [cooldown, setCooldown] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // DM-only: last 20 rolls from anyone. Stays live via the tables:history
  // push (see the effect below for the pull-on-mount/login half).
  const [history, setHistory] = useSocketEvent("tables:history", []);

  // Pull the table list once connected (and again on reconnect, in case the
  // server's data folder changed since this tab was opened).
  useEffect(() => {
    if (!connected) return;
    refreshTables();
  }, [connected]);

  // Also exposed as a manual "Refresh tables" button — a failsafe in case the
  // automatic fetch above ever comes back empty (e.g. a dev-only HMR hiccup).
  async function refreshTables() {
    const response = await commands.listTables();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setTables(response.tables);
    setSelected((current) => current || response.tables[0]?.tableName || "");
  }

  // Pull the current history whenever this page becomes DM-viewable — on
  // mount if already DM, or right after signing in. Pushes handle the rest.
  useEffect(() => {
    if (!connected || !isDm) return;
    commands.rollHistory().then((response) => {
      if (response.ok) setHistory(response.history);
    });
  }, [connected, isDm]);

  // Auto-dismiss the result/error popup after a few seconds.
  useEffect(() => {
    if (!result && !error) return undefined;
    const timeout = window.setTimeout(() => {
      setResult(null);
      setError(null);
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [result, error]);

  function handleDmResult(dmResult) {
    if (!dmResult?.ok) setError(dmResult?.error || "The change failed.");
  }

  async function roll() {
    if (!selected || cooldown) return;
    setRolling(true);
    const response = await commands.rollOnTable(selected);
    setRolling(false);
    if (response.ok) {
      setResult(response);
      setError(null);
      setCooldown(true);
      window.setTimeout(() => setCooldown(false), 1000);
    } else {
      setError(response.error);
      setResult(null);
    }
  }

  return (<div className="mx-auto grid max-w-2xl gap-6 px-5 py-7">
    <div className="flex flex-wrap items-center gap-3">
      <ConnectionStatus connected={connected}/>
      <DmAccess
        connected={connected}
        isDm={isDm}
        onResult={handleDmResult}
        onStatusChange={setIsDm}
      />
    </div>

    <div>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-ember">Table rollers</p>
      <h2 className="font-display text-3xl">Roll on a table</h2>
      <p className="mt-1 text-xs text-stone-500">
        Pulled live from the server's roller table metadata.
      </p>
    </div>

    <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 flex-1 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
        Table
        <select
          className="min-h-11 min-w-0 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-base font-normal text-ink outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
          disabled={!connected || tables.length === 0}
          onChange={(event) => setSelected(event.target.value)}
          value={selected}
        >
          {tables.length === 0 && <option value="">No tables found</option>}
          {tables.map((table) => (<option key={table.tableName} value={table.tableName}>
            {table.tableName} ({table.entryCount} entries)
          </option>))}
        </select>
      </label>
      <button
        className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
        disabled={!connected}
        onClick={refreshTables}
        title="Reload the table list from the server"
        type="button"
      >
        Refresh tables
      </button>
      <button
        className="rounded-lg bg-ember px-5 py-3 font-bold text-white shadow-sm transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:bg-stone-400"
        disabled={!connected || !selected || rolling || cooldown}
        onClick={roll}
        type="button"
      >
        {rolling ? "Rolling…" : "Roll"}
      </button>
    </div>

    {isDm && (<div className="rounded-2xl border border-stone-300 bg-stone-100/80 p-4 shadow-panel">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-ember">DM only</p>
      <h3 className="font-display text-2xl">Roll history</h3>
      <p className="mt-1 text-xs text-stone-500">Last {history.length} of up to 20 rolls, from anyone.</p>
      {history.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No rolls yet.</p>
      ) : (<ul className="mt-3 grid gap-2">
        {history.map((entry, index) => (
          <li
            className="rounded-lg border border-stone-300 bg-white/90 px-3 py-2 text-sm"
            key={`${entry.rolledAt}-${index}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-bold text-ink">{entry.tableName}</span>
              <span className="tabular-nums text-stone-500">{entry.roll} / {entry.count}</span>
            </div>
            {entry.description && <p className="mt-1 text-stone-700">{entry.description}</p>}
            <p className="mt-1 text-[0.65rem] uppercase tracking-wide text-stone-400">{entry.rolledAt}</p>
          </li>
        ))}
      </ul>)}
    </div>)}

    {result && (<div
      className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-stone-300 bg-white p-4 shadow-panel"
      role="status"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-ember">{result.tableName}</p>
      <p className="font-display text-2xl">
        {result.roll} <span className="text-sm font-normal text-stone-500">/ {result.count}</span>
      </p>
      {result.description ? (<p className="mt-1 text-sm text-ink">{result.description}</p>) : (
        <p className="mt-1 text-xs text-stone-500">Only the DM can see the full result.</p>)}
    </div>)}

    {error && (<div
      className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 shadow-panel"
      role="alert"
    >
      {error}
    </div>)}
  </div>);
}
