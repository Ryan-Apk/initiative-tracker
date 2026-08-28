/**
 * Client-side transport layer. Owns the single Socket.IO connection to the
 * server, the emitCommand helper every mutation goes through, and persistence
 * of the DM capability token. Same-origin by design (no URL), so it works
 * identically behind the dev proxy and in production. Route components never
 * talk to socket.io directly — they call commands.* to send and the hooks
 * below to receive, so every page shares one connecting/sending/receiving
 * implementation.
 */
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// Restore any DM token from this tab's session so a reload stays logged in as DM.
const storedToken = sessionStorage.getItem("initiative.dmToken");

// The shared connection. auth carries the DM token on the handshake so the
// server can resume the DM session automatically on connect/reconnect.
export const socket = io({
  autoConnect: true,
  auth: storedToken ? { dmToken: storedToken } : {},
  reconnection: true,
});

// Persist (or clear) the DM token in sessionStorage and update the handshake
// auth so the next (re)connection presents the right credentials.
export function storeDmToken(token) {
  if (token) {
    sessionStorage.setItem("initiative.dmToken", token);
    socket.auth = { dmToken: token };
  } else {
    sessionStorage.removeItem("initiative.dmToken");
    socket.auth = {};
  }
}

// Read the DM token stored for this tab (used to attempt a DM resume on connect).
export function getStoredDmToken() {
  return sessionStorage.getItem("initiative.dmToken");
}

// Track the shared socket's connection state as React state. Any page can
// call this to know whether it's live, without wiring its own connect/
// disconnect listeners — pair the returned value with <ConnectionStatus>.
export function useConnected() {
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    function handleConnect() {
      setConnected(true);
    }

    function handleDisconnect() {
      setConnected(false);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  return connected;
}

// Emit a command and resolve with the server's acknowledgement as a normalized
// { ok, ... } result. Rejects fast when offline, times out after 5s, and sends
// volatile so a mutation is dropped rather than replayed across a disconnect —
// on reconnect the fresh server snapshot is the source of truth, not old edits.
export function emitCommand(event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: "You are offline. Reconnect before making changes." });
      return;
    }

    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: "The server did not acknowledge that change." });
      }
    }, 5000);

    // Volatile events are deliberately dropped if the transport disconnects.
    // We never replay a mutation after reconnecting.
    socket.volatile.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(response ?? { ok: false, error: "The server returned no response." });
    });
  });
}

// Every outbound event, named and payload-shaped so callers never touch a raw
// event string. Each entry is a thin emitCommand wrapper — this is the
// "sending" half of the transport layer.
export const commands = {
  addCombatant: (form) => emitCommand("combatant:add", form),
  updateCombatant: (id, changes) => emitCommand("combatant:update", { id, changes }),
  removeCombatant: (id) => emitCommand("combatant:remove", { id }),
  setCombatantCondition: (id, condition, active) =>
    emitCommand("combatant:set-condition", { id, condition, active }),
  setCombatantControl: (id, playerControlled) =>
    emitCommand("combatant:set-player-controlled", { id, playerControlled }),
  setCombatantAcVisible: (id, visible) =>
    emitCommand("combatant:set-ac-visible", { id, visible }),
  setAllEnemyAcVisible: (visible) =>
    emitCommand("combatants:set-enemy-ac-visible", { visible }),
  setPlayerLocked: (locked) => emitCommand("tracker:set-player-locked", { locked }),
  clearCombat: () => emitCommand("combat:clear"),
  requestState: () => emitCommand("state:request"),
  listTables: () => emitCommand("tables:list"),
  rollOnTable: (tableName) => emitCommand("tables:roll", { tableName }),
  rollHistory: () => emitCommand("tables:history"),
  resumeDm: (token) => emitCommand("dm:resume", { token }),
  loginDm: (password) => emitCommand("dm:login", { password }),
  logoutDm: () => emitCommand("dm:logout"),
};

// Subscribe to a server-pushed event for the component's lifetime, exposing
// the latest value as React state — the "receiving" half of the transport
// layer, and the push-driven counterpart to commands.*. `reduce` decides how
// an incoming payload combines with the current value (default: replace
// outright); it's read from a ref so passing a fresh function each render
// doesn't churn the subscription. Returns a [value, setValue] pair, so a
// caller can also assign the value directly (e.g. from a command's result)
// alongside whatever the server pushes.
export function useSocketEvent(event, initialValue, reduce = (next) => next) {
  const [value, setValue] = useState(initialValue);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  useEffect(() => {
    function handlePayload(payload) {
      setValue((current) => reduceRef.current(payload, current));
    }

    socket.on(event, handlePayload);
    return () => socket.off(event, handlePayload);
  }, [event]);

  return [value, setValue];
}

// Live DM status for pages that don't need the full tracker snapshot (e.g.
// the rollers page). Stays in sync with dm:status pushes, and also pulls the
// current value on (re)connect via state:request — otherwise a page mounted
// after DM status was already established elsewhere (same shared socket)
// wouldn't see it until the next unrelated push. Returns a [isDm, setIsDm]
// pair, so a caller can pass the setter straight to <DmAccess onStatusChange>.
export function useDmStatus() {
  const connected = useConnected();
  const [isDm, setIsDm] = useSocketEvent("dm:status", false, (status) => Boolean(status.isDm));

  useEffect(() => {
    if (!connected) return;
    commands.requestState().then((result) => {
      if (result.ok) setIsDm(result.isDm);
    });
  }, [connected]);

  return [isDm, setIsDm];
}

const INITIAL_SNAPSHOT = { revision: 0, playerLocked: false, combatants: [] };

// Bootstraps and maintains the live tracker view: on every (re)connect it
// resumes a stored DM session and requests a fresh snapshot; thereafter the
// snapshot and DM status stay in sync with server pushes. This is the one
// hook a tracker page needs for connecting + sending + receiving — it
// composes useConnected, commands.*, and useSocketEvent above.
// `onResumeError` is called with a message if a stored DM token turns out to
// be stale, so the caller can surface it however it likes (e.g. a toast).
export function useLiveTracker({ onResumeError } = {}) {
  const connected = useConnected();
  // Bumped on every (re)connect; callers can fold this into row keys to
  // remount editable fields so local drafts are discarded for a fresh snapshot.
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [isDm, setIsDm] = useSocketEvent("dm:status", false, (status) => Boolean(status.isDm));
  const [snapshot, setSnapshot] = useSocketEvent(
    "state:snapshot",
    INITIAL_SNAPSHOT,
    // Accept a push only if it is at least as new as what we hold, so a
    // late/out-of-order delivery can't roll the view back to a stale revision.
    (next, current) => (next.revision >= current.revision ? next : current),
  );

  useEffect(() => {
    if (!connected) return;
    setConnectionGeneration((current) => current + 1);
    const token = getStoredDmToken();
    if (token) {
      commands.resumeDm(token).then((result) => {
        if (!result.ok) {
          storeDmToken(null);
          setIsDm(false);
          onResumeError?.(result.error);
        }
      });
    }
    commands.requestState().then((result) => {
      if (result.ok) {
        setSnapshot(result.snapshot);
        setIsDm(result.isDm);
      }
    });
  }, [connected]);

  return { connected, connectionGeneration, isDm, setIsDm, snapshot };
}
