/**
 * Client mirror of the server's health model (server/domain.js). The server
 * already sends a computed healthTone in every snapshot; this local copy lets
 * the UI derive tone for optimistic/draft states and, crucially, is checked
 * against the server version by the test suite so the two never drift. The
 * label maps turn a tone into the words shown on a row.
 */

// Map current/max HP to a colour band. MUST match server/domain.js healthTone.
export function healthTone({ hpCurrent, hpMax }) {
  if (
    hpCurrent === null ||
    hpCurrent === undefined ||
    hpMax === null ||
    hpMax === undefined
  ) {
    return "neutral";
  }
  if (hpCurrent <= 0) return "defeated";

  const ratio = Math.min(hpCurrent / hpMax, 1) * 100;
  if (ratio >= 75) return "green";
  if (ratio >= 50) return "yellow";
  if (ratio > 25) return "orange";
  return "red";
}

// Detailed labels (with percentage bands) shown when the viewer may see exact
// HP — i.e. the DM, or a player looking at their own entry.
export const healthLabels = {
  neutral: "HP not tracked",
  defeated: "Defeated",
  red: "Critical · 1–25%",
  orange: "Wounded · 26–49%",
  yellow: "Hurt · 50–74%",
  green: "Healthy · 75%+",
};

// Coarse labels (no numbers) shown for enemies to non-DM viewers, so players
// get a sense of an enemy's condition without learning exact HP.
export const publicHealthLabels = {
  neutral: "HP not tracked",
  defeated: "Defeated",
  red: "Critical",
  orange: "Wounded",
  yellow: "Hurt",
  green: "Healthy",
};
