function defaultRandInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getAutoSacrificeCounts(player, typeRolls) {
  void player;
  let woundedSuccesses = 0;
  let healthySuccesses = 0;

  for (const roll of typeRolls) {
    if (roll === 3) {
      woundedSuccesses += 1;
    } else if (roll >= 4 && roll <= 6) {
      healthySuccesses += 1;
    }
  }

  return { woundedSuccesses, healthySuccesses };
}

export function rollContractDice(availableTroops, randInt = defaultRandInt) {
  const rolls = { melee: [], ranged: [], mounted: [] };
  for (const type of ['melee', 'ranged', 'mounted']) {
    for (let i = 0; i < availableTroops[type]; i += 1) {
      rolls[type].push(randInt(1, 6));
    }
  }
  return rolls;
}

export function classifyRolls(rolls, player, { emptyTroops, hasSpecialist }) {
  const successes = emptyTroops();
  let wildcard = 0;
  const wounded = emptyTroops();
  const dead = emptyTroops();
  let drillSergeantFlips = hasSpecialist(player, 'Drill Sergeant') ? 2 : 0;
  const standardBearer = hasSpecialist(player, 'Standard Bearer');

  for (const type of ['melee', 'ranged', 'mounted']) {
    for (const roll of rolls[type]) {
      if (roll <= 2) {
        dead[type] += 1;
      } else if (roll === 3) {
        wounded[type] += 1;
        if (standardBearer) successes[type] += 1;
      } else if (roll <= 5) {
        if (roll === 5 && drillSergeantFlips > 0) {
          wildcard += 1;
          drillSergeantFlips -= 1;
        } else {
          successes[type] += 1;
        }
      } else {
        wildcard += 1;
      }
    }
  }
  return { successes, wildcard, wounded, dead };
}

export function isSacrificeEligibleRoll(player, roll) {
  void player;
  return roll === 3 || (roll >= 4 && roll <= 6);
}

export function previewBattleOutcome(
  player,
  contract,
  rolls,
  sacrificedIndices = null,
  { classifyRolls, cloneTroops },
) {
  const { successes, wildcard: wc, wounded, dead } = classifyRolls(rolls, player);
  const rem = cloneTroops(contract.requirements);
  let remainingWild = wc;
  const exSuc = cloneTroops(successes);

  if (sacrificedIndices !== null) {
    // Apply explicit player sacrifices.
    for (const type of ['melee', 'ranged', 'mounted']) {
      for (const idx of sacrificedIndices[type]) {
        const roll = rolls[type]?.[idx];
        if (roll === undefined) continue;
        const isEligible = isSacrificeEligibleRoll(player, roll);
        if (isEligible) {
          exSuc[type] += 1;
          if (roll === 3) {
            wounded[type] = Math.max(0, wounded[type] - 1);
          }
          dead[type] += 1;
        }
      }
    }
  }

  for (const type of ['melee', 'ranged', 'mounted']) {
    const use = Math.min(exSuc[type], rem[type]);
    rem[type] -= use;
    exSuc[type] -= use;
  }
  for (const type of ['melee', 'ranged', 'mounted']) {
    if (rem[type] === 0) continue;
    const use = Math.min(rem[type], remainingWild);
    rem[type] -= use;
    remainingWild -= use;
  }
  if (sacrificedIndices === null) {
    // Auto-sacrifice potential (AI / simple preview without explicit choices).
    for (const type of ['melee', 'ranged', 'mounted']) {
      if (rem[type] === 0) continue;
      const autoSacrifice = getAutoSacrificeCounts(player, rolls[type]);
      const useFromWounded = Math.min(rem[type], autoSacrifice.woundedSuccesses);
      const remainingNeed = rem[type] - useFromWounded;
      const useFromHealthy = Math.min(remainingNeed, autoSacrifice.healthySuccesses);
      const use = useFromWounded + useFromHealthy;
      rem[type] -= use;
      wounded[type] = Math.max(0, wounded[type] - useFromWounded);
      dead[type] += use;
    }
  }
  const willSucceed = rem.melee + rem.ranged + rem.mounted === 0;
  return { dead, wounded, willSucceed };
}

export function finalizeContractBattle(
  game,
  player,
  contract,
  rolls,
  availableTroops,
  humanSacrificed = null,
  {
    cloneTroops,
    classifyRolls,
    specialistBonus,
    hasSpecialist,
    gainEquipment,
    addEffect,
    countFace,
    countSpecialist,
    drawFromDeck,
    emptyTroops,
  },
) {
  const req = cloneTroops(contract.requirements);
  const { successes, wildcard: initWild, wounded, dead } = classifyRolls(rolls, player);
  let wildcard = initWild;

  const bonus = specialistBonus(player);
  successes.melee += bonus.melee;
  successes.ranged += bonus.ranged;
  successes.mounted += bonus.mounted;
  wildcard += bonus.wildcard;

  // Apply explicit human sacrifices before filling requirements.
  let sacrificed = 0;
  if (humanSacrificed !== null) {
    for (const type of ['melee', 'ranged', 'mounted']) {
      for (const idx of humanSacrificed[type]) {
        const roll = rolls[type]?.[idx];
        if (roll === undefined) continue;
        const isEligible = isSacrificeEligibleRoll(player, roll);
        if (isEligible) {
          successes[type] += 1;
          if (roll === 3) {
            wounded[type] = Math.max(0, wounded[type] - 1);
          }
          dead[type] += 1;
          sacrificed += 1;
        }
      }
    }
  }

  const assigned = emptyTroops();
  for (const type of ['melee', 'ranged', 'mounted']) {
    const use = Math.min(successes[type], req[type]);
    assigned[type] += use;
    req[type] -= use;
    successes[type] -= use;
  }
  for (const type of ['melee', 'ranged', 'mounted']) {
    if (req[type] === 0) continue;
    const use = Math.min(req[type], wildcard);
    req[type] -= use;
    wildcard -= use;
    assigned[type] += use;
  }

  if (humanSacrificed === null) {
    // Auto-sacrifice (AI path only): sacrifice typed-success units for one
    // further success of the same type, preferring wounded successes first.
    for (const type of ['melee', 'ranged', 'mounted']) {
      if (req[type] === 0) continue;
      const autoSacrifice = getAutoSacrificeCounts(player, rolls[type]);
      const useFromWounded = Math.min(req[type], autoSacrifice.woundedSuccesses);
      const remainingNeed = req[type] - useFromWounded;
      const useFromHealthy = Math.min(remainingNeed, autoSacrifice.healthySuccesses);
      const use = useFromWounded + useFromHealthy;
      req[type] -= use;
      wounded[type] = Math.max(0, wounded[type] - useFromWounded);
      dead[type] += use;
      sacrificed += use;
    }
  }

  if ((dead.melee + dead.ranged + dead.mounted) > 0 && hasSpecialist(player, 'Surgeon')) {
    for (const type of ['melee', 'ranged', 'mounted']) {
      if (dead[type] > 0) {
        dead[type] -= 1;
        wounded[type] += 1;
        break;
      }
    }
  }

  if ((dead.melee + dead.ranged + dead.mounted) > 0 && hasSpecialist(player, 'Grave Robber')) {
    const gain = gainEquipment(game, player, 1);
    player.money += 1;
    addEffect(game, `${player.name}'s Grave Robber gained 1 coin${gain > 0 ? ` and ${gain} equipment` : ''}.`);
  }

  if ((dead.melee + dead.ranged + dead.mounted) > 0 && hasSpecialist(player, 'Scavenger')) {
    const ones = countFace(rolls, 1);
    if (ones > 0) {
      player.money += ones;
      addEffect(game, `${player.name}'s Scavenger gained ${ones} coins from losses.`);
    }
  }

  if (sacrificed > 0 && hasSpecialist(player, 'Chaplain')) {
    const draws = Math.min(sacrificed, countSpecialist(player, 'Chaplain'));
    for (let i = 0; i < draws; i += 1) {
      const card = drawFromDeck(game, 'contract');
      if (card) player.hand.push(card);
    }
    if (draws > 0) addEffect(game, `${player.name}'s Chaplain drew ${draws} card(s) from sacrifice.`);
  }

  const success = req.melee + req.ranged + req.mounted === 0;
  for (const type of ['melee', 'ranged', 'mounted']) {
    player.troops[type] -= dead[type];
    game.supply[type] += dead[type];
    availableTroops[type] = Math.max(0, availableTroops[type] - dead[type] - wounded[type]);
  }

  return { success, dead, wounded, rolls, assigned };
}

export function resolveContractBattle(
  game,
  player,
  contract,
  availableTroops,
  { rollContractDice, previewBattleOutcome, finalizeContractBattle, addEffect },
) {
  const rolls = rollContractDice(availableTroops);

  // AI: spend equipment to reroll low-value dice (dead 1-2, then wounded 3)
  // when losing, one at a time.
  // Stop as soon as the battle is projected to be won or equipment runs out.
  if (player.equipment > 0) {
    const types = ['melee', 'ranged', 'mounted'];
    let spent = 0;
    while (player.equipment > 0) {
      const preview = previewBattleOutcome(player, contract, rolls);
      if (preview.willSucceed) break;
      // Reroll the lowest-value die first (1, then 2, then 3) to maximise value.
      let rerolled = false;
      for (const face of [1, 2, 3]) {
        for (const type of types) {
          const idx = rolls[type].indexOf(face);
          if (idx !== -1) {
            rolls[type][idx] = Math.ceil(Math.random() * 6);
            player.equipment -= 1;
            game.armoury += 1;
            spent += 1;
            rerolled = true;
            break;
          }
        }
        if (rerolled) break;
      }
      if (!rerolled) break; // No eligible low-value dice remain to reroll.
    }
    if (spent > 0) {
      addEffect(game, `${player.name} used ${spent} equipment to reroll dice.`);
    }
  }

  return finalizeContractBattle(game, player, contract, rolls, availableTroops);
}