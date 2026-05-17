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
      if (!rerolled) break; // No eligible low-value dice remain to reroll
    }
    if (spent > 0) {
      addEffect(game, `${player.name} used ${spent} equipment to reroll dice.`);
    }
  }

  return finalizeContractBattle(game, player, contract, rolls, availableTroops);
}