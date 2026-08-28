// "Live"/"Reconnecting" badge reflecting the shared socket's connection state.
// Purely presentational — pair it with useConnected() from socket.js.
export default function ConnectionStatus({connected}) {
  return (<span
    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-wide ${connected ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}`}
    role="status"
  >
    <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}/>
    {connected ? "Live" : "Reconnecting"}
  </span>);
}
