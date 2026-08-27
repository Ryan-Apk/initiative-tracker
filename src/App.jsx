import {Navigate, Route, Routes} from "react-router-dom";
import InitiativeTracker from "./routes/initiativeTracker.jsx";

// Top-level router. The tracker lives at /init; everything else redirects
// there for now so existing links/behavior keep working.
export default function App() {
  return (<div>
    <Routes>
      <Route element={<InitiativeTracker/>} path="/init"/>
      <Route element={<Navigate replace to="/init"/>} path="*"/>
    </Routes>
  </div>);
}
