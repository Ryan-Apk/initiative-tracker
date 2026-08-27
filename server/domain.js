/**
 * Pure domain logic for the initiative tracker — validation, normalization,
 * sorting, and derived values. This module performs no I/O (no database, no
 * sockets), which keeps every rule here deterministic and unit-testable. It is
 * the single source of truth shared by the server (server/app.js persists what
 * these functions accept) and, indirectly, the client: the test suite imports
 * both this module and its client mirrors (src/health.js, src/conditions.js) to
 * assert they stay in agreement.
 */

// Fields that hold whole numbers; the rest of validation branches off this set.
const INTEGER_FIELDS = new Set([
  "initiativeRoll",
  "initiativeModifier",
  "ac",
  "hpCurrent",
  "hpMax",
]);

// Fields a client is ever allowed to change; guards normalizeChanges against
// tampering with protected columns (player control, map number, etc.).
export const EDITABLE_FIELDS = new Set([
  "name",
  ...INTEGER_FIELDS,
]);

// Coerce a value to an integer, enforcing optionality and a minimum bound.
// Blank/null/undefined is allowed through as null only when `optional`.
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

// Domain-level "the input was bad" error. server/app.js catches this type and
// returns its message verbatim to the client; any other thrown error is masked
// behind a generic message so internals never leak.
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

// Kept in alphabetical order: the client dropdown relies on this order directly.
export const ALL_CONDITIONS = Object.freeze([
  "Blinded",
  "Charmed",
  "Deafened",
  "Exhaustion",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
]);

// Validate an incoming condition name against the fixed list, rejecting
// anything unknown so clients can only ever toggle a real 5e condition.
export function normalizeConditionName(value) {
  if (typeof value !== "string" || !ALL_CONDITIONS.includes(value)) {
    throw new ValidationError("Unknown condition.");
  }
  return value;
}

// Normalize a stored conditions value (JSON string from SQLite, or an array)
// into a clean array, dropping anything not in ALL_CONDITIONS. Stored as JSON
// so insertion order is preserved: oldest condition first.
export function parseConditions(value) {
  const raw = Array.isArray(value) ? value : safeJsonArray(value);
  return raw.filter((entry) => ALL_CONDITIONS.includes(entry));
}

// Parse a JSON string to an array, tolerating malformed/non-array input by
// returning [] rather than throwing — a corrupt column must not crash a read.
function safeJsonArray(value) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Add or remove one condition, returning the new list. Adding always appends
// (newest last, so the UI can show oldest-first); toggling to the state it is
// already in is a no-op. Idempotent by design.
export function applyConditionToggle(conditions, condition, active) {
  const current = parseConditions(conditions);
  const has = current.includes(condition);
  if (active === has) return current;
  return active ? [...current, condition] : current.filter((entry) => entry !== condition);
}

// Require a non-empty name, collapse internal whitespace, and cap the length.
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

// Validate a whole new-combatant payload into the exact shape the database
// expects. Optional stats become null; required initiative fields must parse.
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

// Validate a partial edit ({field: value, ...}) for combatant:update. Rejects
// unknown or protected fields, so a client cannot smuggle in changes to columns
// that are not user-editable. Returns only the normalized, allowed changes.
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

// Validate a single numeric field, applying its own optionality and minimum
// (AC ≥ 0, Max HP ≥ 1, initiative required; current HP may be any integer).
export function normalizeCombatantField(field, value) {
  if (!INTEGER_FIELDS.has(field)) {
    throw new ValidationError(`Unknown numeric field "${field}".`);
  }
  const optional = field === "ac" || field === "hpCurrent" || field === "hpMax";
  const minimum = field === "ac" ? 0 : field === "hpMax" ? 1 : null;
  return parseInteger(value, labelFor(field), { optional, minimum });
}

// Human-readable label for a field, used in validation error messages.
function labelFor(field) {
  return {
    initiativeRoll: "Initiative roll",
    initiativeModifier: "Initiative modifier",
    ac: "AC",
    hpCurrent: "Current HP",
    hpMax: "Max HP",
  }[field];
}

// Canonical combat order: highest total initiative first, breaking ties by
// modifier (desc), then case-insensitive name, then UUID for a stable, total
// ordering. Returns a new array; the input is not mutated.
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

// Effective initiative = stored base roll + modifier. Rolls are stored
// unmodified, so the total is always derived, never persisted.
export function initiativeTotal(combatant) {
  return combatant.initiativeRoll + combatant.initiativeModifier;
}

// Smallest positive integer not already used as a map number, so deleted
// enemies' numerals get reused. Enemies get these stable battle-map labels.
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

// Redact a snapshot for a non-DM viewer: enemy (DM-controlled) combatants have
// their private numbers stripped — exact HP, base roll/modifier, and AC unless
// individually revealed — while the derived initiative total and health tone
// survive. The DM receives the snapshot untouched. This is the server-side
// enforcement of "players never see hidden enemy stats."
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

// Map current/max HP to a colour band used for row tone and the public health
// word. Neutral when HP is untracked, defeated at 0 or below, otherwise banded
// by percentage. MUST stay identical to src/health.js (a test asserts parity).
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
