import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  healthTone,
  initiativeTotal,
  lowestAvailableMapNumber,
  normalizeChanges,
  normalizeCombatant,
  snapshotForViewer,
  sortCombatants,
} from "../server/domain.js";
import { healthTone as clientHealthTone } from "../src/health.js";

test("sortCombatants applies every server tie-break in order", () => {
  const combatants = [
    { id: "4", name: "Zed", initiativeRoll: 12, initiativeModifier: 2 },
    { id: "3", name: "bram", initiativeRoll: 11, initiativeModifier: 3 },
    { id: "2", name: "Ada", initiativeRoll: 11, initiativeModifier: 3 },
    { id: "1", name: "Late", initiativeRoll: 12, initiativeModifier: 0 },
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

test("initiative totals and reusable map numbers are derived consistently", () => {
  assert.equal(initiativeTotal({ initiativeRoll: 20, initiativeModifier: 2 }), 22);
  assert.equal(
    lowestAvailableMapNumber([
      { mapNumber: 1 },
      { mapNumber: 3 },
      { mapNumber: null },
    ]),
    2,
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

test("server and client health tones agree at every exact boundary", () => {
  const cases = [
    [{ hpCurrent: null, hpMax: 100 }, "neutral"],
    [{ hpCurrent: 100, hpMax: null }, "neutral"],
    [{ hpCurrent: 0, hpMax: 100 }, "defeated"],
    [{ hpCurrent: 1, hpMax: 100 }, "red"],
    [{ hpCurrent: 25, hpMax: 100 }, "red"],
    [{ hpCurrent: 26, hpMax: 100 }, "orange"],
    [{ hpCurrent: 49, hpMax: 100 }, "orange"],
    [{ hpCurrent: 50, hpMax: 100 }, "yellow"],
    [{ hpCurrent: 74, hpMax: 100 }, "yellow"],
    [{ hpCurrent: 75, hpMax: 100 }, "green"],
    [{ hpCurrent: 100, hpMax: 100 }, "green"],
    [{ hpCurrent: 150, hpMax: 100 }, "green"],
  ];

  for (const [combatant, expected] of cases) {
    assert.equal(healthTone(combatant), expected);
    assert.equal(clientHealthTone(combatant), expected);
  }
});

test("public snapshots expose HP only for player-controlled combatants", () => {
  const snapshot = {
    revision: 7,
    playerLocked: true,
    combatants: [
      {
        id: "player",
        playerControlled: true,
        initiativeRoll: 18,
        initiativeModifier: 2,
        initiativeTotal: 20,
        ac: 16,
        acVisible: false,
        hpCurrent: 12,
        hpMax: 20,
        healthTone: "yellow",
      },
      {
        id: "hidden-enemy",
        playerControlled: false,
        initiativeRoll: 15,
        initiativeModifier: 3,
        initiativeTotal: 18,
        ac: 17,
        acVisible: false,
        hpCurrent: 45,
        hpMax: 60,
        healthTone: "green",
      },
      {
        id: "revealed-enemy",
        playerControlled: false,
        initiativeRoll: 10,
        initiativeModifier: 1,
        initiativeTotal: 11,
        ac: 13,
        acVisible: true,
        hpCurrent: 1,
        hpMax: 20,
        healthTone: "red",
      },
    ],
  };

  const publicSnapshot = snapshotForViewer(snapshot, false);
  assert.equal(publicSnapshot.playerLocked, true);
  assert.equal(publicSnapshot.combatants[0].hpCurrent, 12);
  assert.equal(publicSnapshot.combatants[0].initiativeModifier, 2);
  assert.equal(publicSnapshot.combatants[1].hpCurrent, null);
  assert.equal(publicSnapshot.combatants[1].hpMax, null);
  assert.equal(publicSnapshot.combatants[1].initiativeRoll, null);
  assert.equal(publicSnapshot.combatants[1].initiativeModifier, null);
  assert.equal(publicSnapshot.combatants[1].initiativeTotal, 18);
  assert.equal(publicSnapshot.combatants[1].healthTone, "green");
  assert.equal(publicSnapshot.combatants[1].ac, null);
  assert.equal(publicSnapshot.combatants[2].ac, 13);
  assert.strictEqual(snapshotForViewer(snapshot, true), snapshot);
});
