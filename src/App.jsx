import { useEffect, useMemo, useRef, useState } from "react";
import {
  emitCommand,
  getStoredDmToken,
  socket,
  storeDmToken,
} from "./socket.js";

const EMPTY_FORM = {
  name: "",
  initiativeRoll: "",
  initiativeModifier: "0",
  ac: "",
  hpCurrent: "",
  hpMax: "",
};

const FIELD_LABELS = {
  name: "Name",
  initiativeRoll: "Roll",
  initiativeModifier: "Modifier",
  ac: "AC",
  hpCurrent: "Current HP",
  hpMax: "Max HP",
};

function healthTone(combatant) {
  if (combatant.hpCurrent === null || combatant.hpMax === null) return "neutral";
  if (combatant.hpCurrent <= 0) return "defeated";
  const percentage = Math.min(combatant.hpCurrent / combatant.hpMax, 1) * 100;
  if (percentage > 50) return "healthy";
  if (percentage >= 26) return "wounded";
  return "critical";
}

const rowTone = {
  neutral: "border-stone-300 bg-white",
  healthy: "border-emerald-300 bg-emerald-50",
  wounded: "border-amber-300 bg-amber-50",
  critical: "border-red-300 bg-red-50",
  defeated: "border-slate-400 bg-slate-200 text-slate-600",
};

function EditableField({
  combatant,
  field,
  canEdit,
  className = "",
  connected,
  inputMode = "numeric",
  optional = false,
  onCommit,
}) {
  const serverValue = combatant[field] ?? "";
  const [draft, setDraft] = useState(String(serverValue));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(serverValue));
  }, [serverValue]);

  function reset() {
    setDraft(String(serverValue));
  }

  async function commit() {
    focused.current = false;
    if (draft === String(serverValue)) return;
    if (!optional && !draft.trim()) {
      reset();
      onCommit({ ok: false, error: `${FIELD_LABELS[field]} is required.` });
      return;
    }
    const result = await emitCommand("combatant:update", {
      id: combatant.id,
      changes: { [field]: draft },
    });
    if (!result.ok) reset();
    onCommit(result);
  }

  return (
    <label className={`grid min-w-0 gap-1 ${className}`}>
      <span className="truncate text-[0.65rem] font-bold uppercase tracking-wider text-stone-500">
        {FIELD_LABELS[field]}
      </span>
      {canEdit ? (
        <input
          aria-label={`${FIELD_LABELS[field]} for ${combatant.name}`}
          className="min-w-0 w-full rounded-md border border-transparent bg-white/65 px-2 py-2 text-sm font-semibold outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!connected}
          inputMode={inputMode}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              reset();
              event.currentTarget.blur();
            }
          }}
          type={field === "name" ? "text" : "number"}
          value={draft}
        />
      ) : (
        <span className="block min-h-10 min-w-0 truncate rounded-md px-2 py-2 text-sm font-semibold">
          {serverValue === "" ? "—" : serverValue}
        </span>
      )}
    </label>
  );
}

function CombatantRow({ combatant, connected, isDm, onResult, position }) {
  const canEdit = isDm || combatant.playerControlled;
  const tone = healthTone(combatant);

  async function toggleControl() {
    onResult(
      await emitCommand("combatant:set-player-controlled", {
        id: combatant.id,
        playerControlled: !combatant.playerControlled,
      }),
    );
  }

  async function remove() {
    if (!window.confirm(`Remove ${combatant.name} from initiative?`)) return;
    onResult(await emitCommand("combatant:remove", { id: combatant.id }));
  }

  return (
    <article
      className={`min-w-0 rounded-xl border p-3 shadow-sm transition-colors sm:p-4 ${rowTone[tone]}`}
    >
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3 border-b border-black/10 pb-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-stone-500">
            Order
          </span>
          <strong className="font-display text-3xl tabular-nums">
            {String(position).padStart(2, "0")}
          </strong>
          <span className="truncate text-xs text-stone-500">
            Initiative {combatant.initiativeRoll}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDm ? (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition disabled:opacity-50 ${
                combatant.playerControlled
                  ? "border-sky-300 bg-sky-100 text-sky-800"
                  : "border-stone-300 bg-stone-100 text-stone-700"
              }`}
              disabled={!connected}
              onClick={toggleControl}
              type="button"
            >
              {combatant.playerControlled ? "Player" : "DM"}
            </button>
          ) : (
            <span className="text-center text-xs font-bold uppercase tracking-wide text-stone-500">
              {combatant.playerControlled ? "Player" : "DM"}
            </span>
          )}
          {isDm && (
            <button
              aria-label={`Remove ${combatant.name}`}
              className="rounded-md px-2 py-1 text-xl leading-none text-stone-400 transition hover:bg-red-100 hover:text-red-700 disabled:opacity-40"
              disabled={!connected}
              onClick={remove}
              title="Remove combatant"
              type="button"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(11rem,2fr)_repeat(5,minmax(4.5rem,1fr))]">
        <EditableField
          canEdit={canEdit}
          className="col-span-2 sm:col-span-3 lg:col-span-1"
          combatant={combatant}
          connected={connected}
          field="name"
          inputMode="text"
          onCommit={onResult}
        />
        <EditableField
          canEdit={canEdit}
          combatant={combatant}
          connected={connected}
          field="initiativeRoll"
          onCommit={onResult}
        />
        <EditableField
          canEdit={canEdit}
          combatant={combatant}
          connected={connected}
          field="initiativeModifier"
          onCommit={onResult}
        />
        <EditableField
          canEdit={canEdit}
          combatant={combatant}
          connected={connected}
          field="ac"
          onCommit={onResult}
          optional
        />
        <EditableField
          canEdit={canEdit}
          combatant={combatant}
          connected={connected}
          field="hpCurrent"
          onCommit={onResult}
          optional
        />
        <EditableField
          canEdit={canEdit}
          combatant={combatant}
          connected={connected}
          field="hpMax"
          onCommit={onResult}
          optional
        />
      </div>
    </article>
  );
}

function AddCombatant({ connected, isDm, onResult }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!connected || submitting) return;
    setSubmitting(true);
    const result = await emitCommand("combatant:add", form);
    setSubmitting(false);
    onResult(result);
    if (result.ok) setForm(EMPTY_FORM);
  }

  return (
    <form
      className="rounded-2xl border border-stone-300 bg-white/90 p-4 shadow-panel"
      onSubmit={submit}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-ember">New entry</p>
          <h2 className="font-display text-2xl text-ink">Add to the order</h2>
        </div>
        <p className="max-w-md text-right text-xs text-stone-500">
          {isDm
            ? "DM-added entries begin under DM control."
            : "Entries you add begin player-controlled, so everyone can edit them."}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(12rem,2fr)_repeat(5,minmax(6rem,1fr))_auto]">
        {Object.entries(FIELD_LABELS).map(([field, label]) => {
          const optional = ["ac", "hpCurrent", "hpMax"].includes(field);
          return (
            <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600" key={field}>
              {label}
              <input
                className="min-w-0 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-base font-normal text-ink outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                disabled={!connected || submitting}
                inputMode={field === "name" ? "text" : "numeric"}
                onChange={(event) => update(field, event.target.value)}
                placeholder={optional ? "Optional" : field === "initiativeModifier" ? "0" : "Required"}
                required={!optional}
                type={field === "name" ? "text" : "number"}
                value={form[field]}
              />
            </label>
          );
        })}
        <button
          className="w-full self-end rounded-lg bg-ember px-5 py-3 font-bold text-white shadow-sm transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          disabled={!connected || submitting}
          type="submit"
        >
          {submitting ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}

function DmAccess({ connected, isDm, onResult, onStatusChange }) {
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);

  async function login(event) {
    event.preventDefault();
    const result = await emitCommand("dm:login", { password });
    if (result.ok) {
      storeDmToken(result.token);
      setPassword("");
      setOpen(false);
      onStatusChange(true);
    }
    onResult(result);
  }

  async function logout() {
    const result = await emitCommand("dm:logout");
    if (result.ok) {
      storeDmToken(null);
      onStatusChange(false);
    }
    onResult(result);
  }

  if (isDm) {
    return (
      <button
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
        disabled={!connected}
        onClick={logout}
        type="button"
      >
        Leave DM mode
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
        disabled={!connected}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        DM access
      </button>
      {open && (
        <form
          className="absolute right-0 top-12 z-20 grid w-72 gap-3 rounded-xl border border-stone-300 bg-white p-4 shadow-panel"
          onSubmit={login}
        >
          <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
            DM password
            <input
              autoFocus
              className="rounded-lg border border-stone-300 px-3 py-2 text-base font-normal outline-none focus:border-ember focus:ring-2 focus:ring-orange-100"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="rounded-lg bg-ink px-4 py-2 font-bold text-white" type="submit">
            Enter DM mode
          </button>
        </form>
      )}
    </div>
  );
}

function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [isDm, setIsDm] = useState(false);
  const [snapshot, setSnapshot] = useState({ revision: 0, combatants: [] });
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    function handleConnect() {
      setConnected(true);
      setConnectionGeneration((current) => current + 1);
      const token = getStoredDmToken();
      if (token) {
        emitCommand("dm:resume", { token }).then((result) => {
          if (!result.ok) {
            storeDmToken(null);
            setIsDm(false);
            setNotice({ type: "error", text: result.error });
          }
        });
      }
      emitCommand("state:request").then((result) => {
        if (result.ok) {
          setSnapshot(result.snapshot);
          setIsDm(result.isDm);
        }
      });
    }
    function handleDisconnect() {
      setConnected(false);
    }
    function handleSnapshot(nextSnapshot) {
      setSnapshot((current) =>
        nextSnapshot.revision >= current.revision ? nextSnapshot : current,
      );
    }
    function handleDmStatus(status) {
      setIsDm(Boolean(status.isDm));
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("state:snapshot", handleSnapshot);
    socket.on("dm:status", handleDmStatus);
    if (socket.connected) handleConnect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("state:snapshot", handleSnapshot);
      socket.off("dm:status", handleDmStatus);
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const counts = useMemo(() => {
    return snapshot.combatants.reduce(
      (current, combatant) => {
        current.total += 1;
        if (combatant.playerControlled) current.players += 1;
        return current;
      },
      { total: 0, players: 0 },
    );
  }, [snapshot.combatants]);

  function handleResult(result) {
    if (!result?.ok) {
      setNotice({ type: "error", text: result?.error || "The change failed." });
    }
  }

  async function clearCombat() {
    if (!window.confirm("Clear every combatant from this initiative tracker?")) return;
    handleResult(await emitCommand("combat:clear"));
  }

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="border-b border-stone-300 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-ember">
              Rivergate table tools
            </p>
            <h1 className="font-display text-4xl">Initiative Tracker</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-wide ${
                connected
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-red-300 bg-red-50 text-red-800"
              }`}
              role="status"
            >
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
              {connected ? "Live" : "Reconnecting"}
            </span>
            <span className="text-xs text-stone-500">
              Revision {snapshot.revision} · {counts.total} entries
            </span>
            {isDm && (
              <span className="rounded-full bg-ink px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
                DM mode
              </span>
            )}
            <DmAccess
              connected={connected}
              isDm={isDm}
              onResult={handleResult}
              onStatusChange={setIsDm}
            />
          </div>
        </div>
      </header>

      {!connected && (
        <div className="border-b border-red-300 bg-red-100 px-4 py-3 text-center text-sm font-semibold text-red-900">
          Changes are disabled while disconnected. Local edits will not be queued.
        </div>
      )}

      <main className="mx-auto grid max-w-[1500px] gap-6 px-5 py-7">
        <AddCombatant connected={connected} isDm={isDm} onResult={handleResult} />

        <section className="rounded-2xl border border-stone-300 bg-stone-100/80 p-4 shadow-panel">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-ember">Combat order</p>
              <h2 className="font-display text-3xl">
                Highest first
              </h2>
              <p className="mt-1 text-xs text-stone-500">
                Ties use modifier, then name. {counts.players} player-controlled.
              </p>
            </div>
            {isDm && snapshot.combatants.length > 0 && (
              <button
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-red-700 hover:bg-red-50 disabled:opacity-50"
                disabled={!connected}
                onClick={clearCombat}
                type="button"
              >
                Clear tracker
              </button>
            )}
          </div>

          <div className="min-w-0">
            <div className="grid gap-2">
              {snapshot.combatants.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-300 bg-white/70 px-5 py-14 text-center">
                  <p className="font-display text-2xl text-stone-600">The field is quiet.</p>
                  <p className="mt-1 text-sm text-stone-500">Add the first combatant above.</p>
                </div>
              ) : (
                snapshot.combatants.map((combatant, index) => (
                  <CombatantRow
                    combatant={combatant}
                    connected={connected}
                    isDm={isDm}
                    key={`${combatant.id}-${connectionGeneration}`}
                    onResult={handleResult}
                    position={index + 1}
                  />
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      {notice && (
        <div
          className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 shadow-panel"
          role="alert"
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}

export default App;
