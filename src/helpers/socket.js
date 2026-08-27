/**
 * Client-side transport layer. Owns the single Socket.IO connection to the
 * server, the emitCommand helper every mutation goes through, and persistence
 * of the DM capability token. Same-origin by design (no URL), so it works
 * identically behind the dev proxy and in production. App.jsx imports these;
 * it never talks to socket.io directly.
 */
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
