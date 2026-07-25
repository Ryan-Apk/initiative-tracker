import { useEffect, useMemo, useRef, useState } from "react";
import {
  emitCommand,
  getStoredDmToken,
  socket,
  storeDmToken,
} from "./socket.js";
import {
  healthLabels,
  healthTone,
  publicHealthLabels,
} from "./health.js";

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

const rowTone = {
  neutral: "border-2 border-stone-400 bg-stone-100",
  green: "border-2 border-green-800 bg-green-300",
  yellow: "border-2 border-yellow-700 bg-yellow-300",
  orange: "border-2 border-orange-800 bg-orange-300",
  red: "border-2 border-red-900 bg-red-400",
  defeated: "border-2 border-black bg-black text-white",
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
      <span className="w-fit max-w-full truncate rounded-sm bg-white/80 px-1 text-[0.65rem] font-bold uppercase tracking-wider text-stone-700">
        {FIELD_LABELS[field]}
      </span>
      {canEdit ? (
        <input
          aria-label={`${FIELD_LABELS[field]} for ${combatant.name}`}
          className="min-w-0 w-full rounded-md border border-stone-400 bg-white/90 px-2 py-2 text-sm font-semibold text-ink outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
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
        <span className="block min-h-10 min-w-0 truncate rounded-md border border-black/20 bg-white/80 px-2 py-2 text-sm font-semibold text-ink">
          {serverValue === "" ? "—" : serverValue}
        </span>
      )}
    </label>
  );
}

function draftTotal(roll, modifier) {
  if (String(roll).trim() === "" || String(modifier).trim() === "") return "—";
  const parsedRoll = Number(roll);
  const parsedModifier = Number(modifier);
  if (!Number.isInteger(parsedRoll) || !Number.isInteger(parsedModifier)) return "—";
  return parsedRoll + parsedModifier;
}

function InitiativeControls({
  combatant,
  canEdit,
  connected,
  onCommit,
  publicEnemy = false,
}) {
  const [rollDraft, setRollDraft] = useState(String(combatant.initiativeRoll ?? ""));
  const [modifierDraft, setModifierDraft] = useState(String(combatant.initiativeModifier ?? ""));
  const rollFocused = useRef(false);
  const modifierFocused = useRef(false);
  const rollInput = useRef(null);

  useEffect(() => {
    if (!rollFocused.current) setRollDraft(String(combatant.initiativeRoll ?? ""));
  }, [combatant.initiativeRoll]);

  useEffect(() => {
    if (!modifierFocused.current) {
      setModifierDraft(String(combatant.initiativeModifier ?? ""));
    }
  }, [combatant.initiativeModifier]);

  async function commit(field, draft, reset) {
    if (field === "initiativeRoll") rollFocused.current = false;
    else modifierFocused.current = false;
    const serverValue = String(combatant[field] ?? "");
    if (draft === serverValue) return;
    if (!draft.trim()) {
      reset(serverValue);
      onCommit({ ok: false, error: `${FIELD_LABELS[field]} is required.` });
      return;
    }
    const result = await emitCommand("combatant:update", {
      id: combatant.id,
      changes: { [field]: draft },
    });
    if (!result.ok) reset(serverValue);
    onCommit(result);
  }

  if (publicEnemy) {
    return (
      <label className="grid min-w-0 gap-1">
        <span className="w-fit rounded-sm bg-white/80 px-1 text-[0.65rem] font-bold uppercase tracking-wider text-stone-700">
          Roll
        </span>
        <span className="block min-h-10 rounded-md border border-black/20 bg-white/80 px-3 py-2 text-lg font-bold tabular-nums text-ink">
          {combatant.initiativeTotal}
        </span>
      </label>
    );
  }

  const total = draftTotal(rollDraft, modifierDraft);

  return (
    <>
      <label className="grid min-w-0 gap-1">
        <span className="w-fit rounded-sm bg-white/80 px-1 text-[0.65rem] font-bold uppercase tracking-wider text-stone-700">
          Roll
        </span>
        <div
          className={`flex min-h-10 min-w-0 items-center gap-1 rounded-md border border-stone-400 bg-white/90 px-2 py-1.5 text-ink transition ${
            canEdit && connected
              ? "cursor-text focus-within:border-ember focus-within:ring-2 focus-within:ring-orange-100"
              : ""
          }`}
          onClick={() => {
            if (canEdit && connected) rollInput.current?.focus();
          }}
        >
          <strong className="text-lg tabular-nums">{total}</strong>
          <span aria-hidden="true" className="text-stone-400">(</span>
          {canEdit ? (
            <input
              aria-label={`Base roll for ${combatant.name}`}
              className="w-14 min-w-0 bg-transparent py-0.5 text-sm font-semibold tabular-nums text-stone-500 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!connected}
              inputMode="numeric"
              onBlur={() => commit("initiativeRoll", rollDraft, setRollDraft)}
              onChange={(event) => setRollDraft(event.target.value)}
              onFocus={() => {
                rollFocused.current = true;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setRollDraft(String(combatant.initiativeRoll));
                  event.currentTarget.blur();
                }
              }}
              ref={rollInput}
              required
              type="number"
              value={rollDraft}
            />
          ) : (
            <span className="text-sm font-semibold tabular-nums text-stone-500">
              {rollDraft}
            </span>
          )}
          <span aria-hidden="true" className="text-stone-400">)</span>
        </div>
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="w-fit rounded-sm bg-white/80 px-1 text-[0.65rem] font-bold uppercase tracking-wider text-stone-700">
          Modifier
        </span>
        {canEdit ? (
          <input
            aria-label={`Modifier for ${combatant.name}`}
            className="min-h-10 min-w-0 w-full rounded-md border border-stone-400 bg-white/90 px-2 py-2 text-sm font-semibold text-ink outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!connected}
            inputMode="numeric"
            onBlur={() =>
              commit("initiativeModifier", modifierDraft, setModifierDraft)
            }
            onChange={(event) => setModifierDraft(event.target.value)}
            onFocus={() => {
              modifierFocused.current = true;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setModifierDraft(String(combatant.initiativeModifier));
                event.currentTarget.blur();
              }
            }}
            required
            type="number"
            value={modifierDraft}
          />
        ) : (
          <span className="block min-h-10 rounded-md border border-black/20 bg-white/80 px-2 py-2 text-sm font-semibold text-ink">
            {modifierDraft}
          </span>
        )}
      </label>
    </>
  );
}

function NewInitiativeControls({ disabled, form, update }) {
  const rollInput = useRef(null);
  const total = draftTotal(form.initiativeRoll, form.initiativeModifier);

  return (
    <>
      <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
        Roll
        <div
          className={`flex min-h-11 min-w-0 items-center gap-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-ink transition ${
            disabled
              ? "opacity-50"
              : "cursor-text focus-within:border-ember focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100"
          }`}
          onClick={() => {
            if (!disabled) rollInput.current?.focus();
          }}
        >
          <strong className="text-xl tabular-nums">{total}</strong>
          <span aria-hidden="true" className="text-stone-400">(</span>
          <input
            aria-label="Base initiative roll"
            className="w-16 min-w-0 bg-transparent text-base font-semibold tabular-nums text-stone-500 outline-none"
            disabled={disabled}
            inputMode="numeric"
            onChange={(event) => update("initiativeRoll", event.target.value)}
            placeholder="Roll"
            ref={rollInput}
            required
            type="number"
            value={form.initiativeRoll}
          />
          <span aria-hidden="true" className="text-stone-400">)</span>
        </div>
      </label>
      <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
        Modifier
        <input
          className="min-h-11 min-w-0 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-base font-normal text-ink outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
          disabled={disabled}
          inputMode="numeric"
          onChange={(event) => update("initiativeModifier", event.target.value)}
          required
          type="number"
          value={form.initiativeModifier}
        />
      </label>
    </>
  );
}

function CombatantRow({
  combatant,
  connected,
  isDm,
  onResult,
  playerLocked,
}) {
  const publicEnemy = !isDm && !combatant.playerControlled;
  const canEdit = isDm || (combatant.playerControlled && !playerLocked);
  const showsExactHealth = isDm || combatant.playerControlled;
  const tone = combatant.healthTone || healthTone(combatant);
  const healthLabel = publicEnemy
    ? publicHealthLabels[tone]
    : healthLabels[tone];

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

  async function toggleAcVisibility() {
    onResult(
      await emitCommand("combatant:set-ac-visible", {
        id: combatant.id,
        visible: !combatant.acVisible,
      }),
    );
  }

  return (
    <article
      className={`min-w-0 rounded-xl p-3 shadow-sm transition-colors sm:p-4 ${rowTone[tone]}`}
    >
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3 border-b border-black/10 pb-3">
        <div className="flex min-w-0 items-baseline gap-3">
          {!combatant.playerControlled && Number.isInteger(combatant.mapNumber) && (
            <strong
              aria-label={`Map number ${combatant.mapNumber}`}
              className="min-w-10 rounded-md bg-white/85 px-2 py-1 text-center font-display text-3xl tabular-nums text-ink"
            >
              {combatant.mapNumber}
            </strong>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-full border border-black/25 bg-white/85 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wide text-stone-900">
            {healthLabel}
          </span>
          {isDm && !combatant.playerControlled && (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition disabled:opacity-50 ${
                combatant.acVisible
                  ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                  : "border-stone-300 bg-stone-100 text-stone-700"
              }`}
              disabled={!connected}
              onClick={toggleAcVisibility}
              type="button"
            >
              {combatant.acVisible ? "Hide AC" : "Show AC"}
            </button>
          )}
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
            <span className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-stone-800">
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
      <div
        className={`grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 ${
          showsExactHealth
            ? "lg:grid-cols-[minmax(11rem,2fr)_repeat(5,minmax(4.5rem,1fr))]"
            : "lg:grid-cols-[minmax(11rem,2fr)_repeat(2,minmax(4.5rem,1fr))]"
        }`}
      >
        <EditableField
          canEdit={canEdit}
          className="col-span-2 sm:col-span-3 lg:col-span-1"
          combatant={combatant}
          connected={connected}
          field="name"
          inputMode="text"
          onCommit={onResult}
        />
        <InitiativeControls
          combatant={combatant}
          canEdit={canEdit}
          connected={connected}
          onCommit={onResult}
          publicEnemy={publicEnemy}
        />
        {publicEnemy && !combatant.acVisible ? (
          <label className="grid min-w-0 gap-1">
            <span className="w-fit rounded-sm bg-white/80 px-1 text-[0.65rem] font-bold uppercase tracking-wider text-stone-700">
              AC
            </span>
            <span className="block min-h-10 rounded-md border border-black/20 bg-white/80 px-2 py-2 text-sm font-semibold text-stone-500">
              Hidden
            </span>
          </label>
        ) : (
          <EditableField
            canEdit={canEdit}
            combatant={combatant}
            connected={connected}
            field="ac"
            onCommit={onResult}
            optional
          />
        )}
        {showsExactHealth && (
          <>
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
          </>
        )}
      </div>
    </article>
  );
}

function AddCombatant({ connected, isDm, onResult, playerLocked }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const playerMayEdit = isDm || !playerLocked;
  const disabled = !connected || submitting || !playerMayEdit;

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (disabled) return;
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
            : playerLocked
              ? "The DM has locked player editing."
              : "Entries you add begin player-controlled, so everyone can edit them."}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(12rem,2fr)_repeat(5,minmax(6rem,1fr))_auto]">
        <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
          Name
          <input
            className="min-h-11 min-w-0 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-base font-normal text-ink outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
            disabled={disabled}
            inputMode="text"
            onChange={(event) => update("name", event.target.value)}
            placeholder="Required"
            required
            type="text"
            value={form.name}
          />
        </label>
        <NewInitiativeControls disabled={disabled} form={form} update={update} />
        {Object.entries(FIELD_LABELS)
          .filter(([field]) => ["ac", "hpCurrent", "hpMax"].includes(field))
          .map(([field, label]) => (
            <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600" key={field}>
              {label}
              <input
                className="min-h-11 min-w-0 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-base font-normal text-ink outline-none transition focus:border-ember focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                disabled={disabled}
                inputMode="numeric"
                onChange={(event) => update(field, event.target.value)}
                placeholder="Optional"
                type="number"
                value={form[field]}
              />
            </label>
          ))}
        <button
          className="w-full self-end rounded-lg bg-ember px-5 py-3 font-bold text-white shadow-sm transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          disabled={disabled}
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
  const [snapshot, setSnapshot] = useState({
    revision: 0,
    playerLocked: false,
    combatants: [],
  });
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

  async function togglePlayerLock() {
    handleResult(
      await emitCommand("tracker:set-player-locked", {
        locked: !snapshot.playerLocked,
      }),
    );
  }

  async function setAllEnemyAc(visible) {
    handleResult(
      await emitCommand("combatants:set-enemy-ac-visible", { visible }),
    );
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
            {isDm && (
              <button
                className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wide transition disabled:opacity-50 ${
                  snapshot.playerLocked
                    ? "border-amber-400 bg-amber-100 text-amber-900"
                    : "border-stone-300 bg-white text-stone-700 hover:border-stone-500"
                }`}
                disabled={!connected}
                onClick={togglePlayerLock}
                type="button"
              >
                {snapshot.playerLocked ? "Unlock player editing" : "Lock player editing"}
              </button>
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

      {connected && snapshot.playerLocked && !isDm && (
        <div className="border-b border-amber-400 bg-amber-100 px-4 py-3 text-center text-sm font-semibold text-amber-950">
          The DM has locked player editing. The live tracker remains visible.
        </div>
      )}

      <main className="mx-auto grid max-w-[1500px] gap-6 px-5 py-7">
        <AddCombatant
          connected={connected}
          isDm={isDm}
          onResult={handleResult}
          playerLocked={snapshot.playerLocked}
        />

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
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
                  disabled={!connected}
                  onClick={() => setAllEnemyAc(true)}
                  type="button"
                >
                  Show all enemy AC
                </button>
                <button
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
                  disabled={!connected}
                  onClick={() => setAllEnemyAc(false)}
                  type="button"
                >
                  Hide all enemy AC
                </button>
                <button
                  className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-red-700 hover:bg-red-50 disabled:opacity-50"
                  disabled={!connected}
                  onClick={clearCombat}
                  type="button"
                >
                  Clear tracker
                </button>
              </div>
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
                snapshot.combatants.map((combatant) => (
                  <CombatantRow
                    combatant={combatant}
                    connected={connected}
                    isDm={isDm}
                    key={`${combatant.id}-${connectionGeneration}`}
                    onResult={handleResult}
                    playerLocked={snapshot.playerLocked}
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
