import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  healthTone,
  normalizeChanges,
  normalizeCombatant,
  sortCombatants,
} from "../server/domain.js";

test("sortCombatants applies every server tie-break in order", () => {
  const combatants = [
    { id: "4", name: "Zed", initiativeRoll: 14, initiativeModifier: 2 },
    { id: "3", name: "bram", initiativeRoll: 14, initiativeModifier: 3 },
    { id: "2", name: "Ada", initiativeRoll: 14, initiativeModifier: 3 },
    { id: "1", name: "Late", initiativeRoll: 12, initiativeModifier: 99 },
  ];

  assert.deepEqual(
    sortCombatants(combatants).map(({ id }) => id),
    ["2", "3", "4", "1"],
  );
});

test("sortCombatants uses id when names match case-insensitively", () => {
  const combatants = [
    { id: "b", name: "Aster", initiativeRoll: 10, initiativeModifier: 1 },
    { id: "a", name: "aster", initiativeRoll: 10, initiativeModifier: 1 },
  ];

  assert.deepEqual(
    sortCombatants(combatants).map(({ id }) => id),
    ["a", "b"],
  );
});

test("normalizeCombatant accepts optional blanks and overhealing", () => {
  assert.deepEqual(
    normalizeCombatant({
      name: "  Avon   Vale ",
      initiativeRoll: "17",
      initiativeModifier: "-1",
      ac: "",
      hpCurrent: "25",
      hpMax: "10",
    }),
    {
      name: "Avon Vale",
      initiativeRoll: 17,
      initiativeModifier: -1,
      ac: null,
      hpCurrent: 25,
      hpMax: 10,
    },
  );
});

test("normalizeChanges rejects protected and non-integer values", () => {
  assert.throws(
    () => normalizeChanges({ playerControlled: true }),
    ValidationError,
  );
  assert.throws(
    () => normalizeChanges({ initiativeRoll: "12.5" }),
    ValidationError,
  );
});

test("healthTone follows neutral, green, amber, red, and gray boundaries", () => {
  assert.equal(healthTone({ hpCurrent: null, hpMax: 10 }), "neutral");
  assert.equal(healthTone({ hpCurrent: 20, hpMax: null }), "neutral");
  assert.equal(healthTone({ hpCurrent: 101, hpMax: 100 }), "healthy");
  assert.equal(healthTone({ hpCurrent: 51, hpMax: 100 }), "healthy");
  assert.equal(healthTone({ hpCurrent: 50, hpMax: 100 }), "wounded");
  assert.equal(healthTone({ hpCurrent: 26, hpMax: 100 }), "wounded");
  assert.equal(healthTone({ hpCurrent: 25, hpMax: 100 }), "critical");
  assert.equal(healthTone({ hpCurrent: 1, hpMax: 100 }), "critical");
  assert.equal(healthTone({ hpCurrent: 0, hpMax: 100 }), "defeated");
  assert.equal(healthTone({ hpCurrent: -3, hpMax: 100 }), "defeated");
});
