/**
 * Client entry point. Vite loads this module first; it mounts the React <App>
 * (the whole UI) into the #root element and pulls in the global stylesheet.
 * StrictMode is intentional — it surfaces effect-cleanup bugs during development.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
