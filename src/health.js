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

export const healthLabels = {
  neutral: "HP not tracked",
  defeated: "Defeated",
  red: "Critical · 1–25%",
  orange: "Wounded · 26–49%",
  yellow: "Hurt · 50–74%",
  green: "Healthy · 75%+",
};
