import {useState} from "react";
import {commands, storeDmToken} from "./socket.js";

// Header DM login/logout control. When not a DM it reveals a password popover;
// when a DM it offers "Leave DM mode". On success it persists/clears the token
// (via socket.js) so the DM session survives reloads until the token is dropped.
export default function DmAccess({connected, isDm, onResult, onStatusChange}) {
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);

  // Attempt DM login; on success store the returned token and close the popover.
  async function login(event) {
    event.preventDefault();
    const result = await commands.loginDm(password);
    if (result.ok) {
      storeDmToken(result.token);
      setPassword("");
      setOpen(false);
      onStatusChange(true);
    }
    onResult(result);
  }

  // Leave DM mode and forget the stored token.
  async function logout() {
    const result = await commands.logoutDm();
    if (result.ok) {
      storeDmToken(null);
      onStatusChange(false);
    }
    onResult(result);
  }

  if (isDm) {
    return (<button
      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
      disabled={!connected}
      onClick={logout}
      type="button"
    >
      Leave DM mode
    </button>);
  }

  return (<div className="relative">
    <button
      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
      disabled={!connected}
      onClick={() => setOpen((current) => !current)}
      type="button"
    >
      DM access
    </button>
    {open && (<form
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
    </form>)}
  </div>);
}
