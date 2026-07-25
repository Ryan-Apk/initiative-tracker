const INTEGER_FIELDS = new Set([
  "initiativeRoll",
  "initiativeModifier",
  "ac",
  "hpCurrent",
  "hpMax",
]);

export const EDITABLE_FIELDS = new Set([
  "name",
  ...INTEGER_FIELDS,
]);

function parseInteger(value, field, { optional = false, minimum = null } = {}) {
  if (optional && (value === "" || value === null || value === undefined)) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${field} must be a whole number.`);
  }
  if (minimum !== null && parsed < minimum) {
    throw new ValidationError(`${field} must be at least ${minimum}.`);
  }
  return parsed;
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export function normalizeName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("Name is required.");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > 80) {
    throw new ValidationError("Name must be 80 characters or fewer.");
  }
  return name;
}

export function normalizeCombatant(input = {}) {
  return {
    name: normalizeName(input.name),
    initiativeRoll: parseInteger(input.initiativeRoll, "Initiative roll"),
    initiativeModifier: parseInteger(
      input.initiativeModifier ?? 0,
      "Initiative modifier",
    ),
    ac: parseInteger(input.ac, "AC", { optional: true, minimum: 0 }),
    hpCurrent: parseInteger(input.hpCurrent, "Current HP", { optional: true }),
    hpMax: parseInteger(input.hpMax, "Max HP", { optional: true, minimum: 1 }),
  };
}

export function normalizeChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new ValidationError("No valid changes were supplied.");
  }

  const entries = Object.entries(changes);
  if (entries.length === 0) {
    throw new ValidationError("No valid changes were supplied.");
  }

  const normalized = {};
  for (const [field, value] of entries) {
    if (!EDITABLE_FIELDS.has(field)) {
      throw new ValidationError(`The field "${field}" cannot be changed.`);
    }
    if (field === "name") {
      normalized.name = normalizeName(value);
    } else {
      normalized[field] = normalizeCombatantField(field, value);
    }
  }
  return normalized;
}

export function normalizeCombatantField(field, value) {
  if (!INTEGER_FIELDS.has(field)) {
    throw new ValidationError(`Unknown numeric field "${field}".`);
  }
  const optional = field === "ac" || field === "hpCurrent" || field === "hpMax";
  const minimum = field === "ac" ? 0 : field === "hpMax" ? 1 : null;
  return parseInteger(value, labelFor(field), { optional, minimum });
}

function labelFor(field) {
  return {
    initiativeRoll: "Initiative roll",
    initiativeModifier: "Initiative modifier",
    ac: "AC",
    hpCurrent: "Current HP",
    hpMax: "Max HP",
  }[field];
}

export function sortCombatants(combatants) {
  return [...combatants].sort((first, second) => {
    return (
      initiativeTotal(second) - initiativeTotal(first) ||
      second.initiativeModifier - first.initiativeModifier ||
      first.name.localeCompare(second.name, undefined, { sensitivity: "base" }) ||
      first.id.localeCompare(second.id)
    );
  });
}

export function initiativeTotal(combatant) {
  return combatant.initiativeRoll + combatant.initiativeModifier;
}

export function lowestAvailableMapNumber(combatants) {
  const used = new Set(
    combatants
      .map((combatant) => combatant.mapNumber)
      .filter((mapNumber) => Number.isInteger(mapNumber) && mapNumber > 0),
  );
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

export function snapshotForViewer(snapshot, viewerIsDm) {
  if (viewerIsDm) return snapshot;
  return {
    ...snapshot,
    combatants: snapshot.combatants.map((combatant) => {
      if (combatant.playerControlled) return combatant;
      return {
        ...combatant,
        initiativeRoll: null,
        initiativeModifier: null,
        ac: combatant.acVisible ? combatant.ac : null,
        hpCurrent: null,
        hpMax: null,
      };
    }),
  };
}

export function healthTone({ hpCurrent, hpMax }) {
  if (hpCurrent === null || hpCurrent === undefined || hpMax === null || hpMax === undefined) {
    return "neutral";
  }
  if (hpCurrent <= 0) return "defeated";

  const ratio = Math.min(hpCurrent / hpMax, 1) * 100;
  if (ratio >= 75) return "green";
  if (ratio >= 50) return "yellow";
  if (ratio > 25) return "orange";
  return "red";
}
