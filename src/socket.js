import { io } from "socket.io-client";

const storedToken = sessionStorage.getItem("initiative.dmToken");

export const socket = io({
  autoConnect: true,
  auth: storedToken ? { dmToken: storedToken } : {},
  reconnection: true,
});

export function storeDmToken(token) {
  if (token) {
    sessionStorage.setItem("initiative.dmToken", token);
    socket.auth = { dmToken: token };
  } else {
    sessionStorage.removeItem("initiative.dmToken");
    socket.auth = {};
  }
}

export function getStoredDmToken() {
  return sessionStorage.getItem("initiative.dmToken");
}

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
