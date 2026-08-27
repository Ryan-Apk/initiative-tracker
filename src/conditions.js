/**
 * Client mirror of the server's canonical condition list (server/domain.js
 * ALL_CONDITIONS). The UI renders the "Add conditions" dropdown straight from
 * this array, so its alphabetical order is the on-screen order. A test asserts
 * this list stays identical to the server's, so the two cannot drift apart.
 */

// Kept in alphabetical order for the dropdown.
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
