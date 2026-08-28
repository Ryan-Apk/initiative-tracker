import {Navigate, Route, Routes, useLocation} from "react-router-dom";
import InitiativeTracker from "./routes/initiativeTracker.jsx";
import RollerPage from "./routes/rollerPage.jsx";
import { useNavigate } from 'react-router-dom';

function NavBar() {
  const location = useLocation();
  const currentPath = location.pathname;
  const navigate = useNavigate();

  let navTitle = "Ryan's table tools";
  if (currentPath === "/" || currentPath === "/init") {
    navTitle = "Initiative Tracker";
  } else if (currentPath === "/tables") {
    navTitle = "Table Rollers";
  }

  return (<div className="border-b max-w-[1500px] gap-4 px-5 py-5 mx-auto flex flex-row">
    <div
      className=" border-stone-300 bg-white/80 backdrop-blur">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-ember">
        Rivergate table tools
      </p>
      <h1 className="font-display text-4xl">{navTitle}</h1>
    </div>
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <button
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
        type="button"
        onClick={() => {
          navigate('/init', { replace: true });
        }}
      >
        Initiative Tracker
      </button>

      <button
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-stone-700 hover:border-stone-500 disabled:opacity-50"
        type="button"
        onClick={() => {
          navigate('/tables', { replace: true });
        }}
      >
        Table Rollers
      </button>
    </div>
  </div>)
}

// Top-level router. The tracker lives at /init; everything else redirects
// there for now so existing links/behavior keep working.
export default function App() {
  return (<div className="bg-white/80">
    <NavBar/>
    <Routes>
      <Route element={<InitiativeTracker/>} path="/init"/>
      <Route element={<RollerPage/>} path="/tables"/>
      <Route element={<Navigate replace to="/init"/>} path="*"/>
    </Routes>
  </div>);
}
