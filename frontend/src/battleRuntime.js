import {
  classifyRolls,
  finalizeContractBattle,
  previewBattleOutcome,
  resolveContractBattle,
  rollContractDice,
} from './contractResolution';

export function createBattleRuntime({
  rand,
  emptyTroops,
  hasSpecialist,
  cloneTroops,
  specialistBonus,
  gainEquipment,
  addEffect,
  countFace,
  countSpecialist,
  drawFromDeck,
}) {
  const classify = (rolls, player) => classifyRolls(rolls, player, {
    emptyTroops,
    hasSpecialist,
  });

  const roll = (availableTroops) => rollContractDice(availableTroops, rand);

  const preview = (player, contract, rolls, sacrificedIndices = null) => previewBattleOutcome(
    player,
    contract,
    rolls,
    sacrificedIndices,
    {
      classifyRolls: classify,
      cloneTroops,
    },
  );

  const finalize = (game, player, contract, rolls, availableTroops, humanSacrificed = null) => finalizeContractBattle(
    game,
    player,
    contract,
    rolls,
    availableTroops,
    humanSacrificed,
    {
      cloneTroops,
      classifyRolls: classify,
      specialistBonus,
      hasSpecialist,
      gainEquipment,
      addEffect,
      countFace,
      countSpecialist,
      drawFromDeck,
      emptyTroops,
    },
  );

  const resolve = (game, player, contract, availableTroops) => resolveContractBattle(
    game,
    player,
    contract,
    availableTroops,
    {
      rollContractDice: roll,
      previewBattleOutcome: preview,
      finalizeContractBattle: finalize,
      addEffect,
    },
  );

  return {
    classifyRolls: classify,
    rollContractDice: roll,
    previewBattleOutcome: preview,
    finalizeContractBattle: finalize,
    resolveContractBattle: resolve,
  };
}