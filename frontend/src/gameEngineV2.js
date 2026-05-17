import {
  createGame as createClassicGame,
  runMultipleSimulations as runClassicMultipleSimulations,
  runAiTurn as runClassicAiTurn,
  beginInteractiveTurn as beginClassicInteractiveTurn,
  humanDrawCard as classicHumanDrawCard,
  autoPlayUntilHumanOrEnd as classicAutoPlayUntilHumanOrEnd,
  getActivePlayer,
  setTurnPhase,
  getRuleset,
  nextPlayer,
  maybeEndGame,
  refreshOffer,
  addLog,
} from './gameEngine';

export * from './gameEngine';

// -------------------------------------------------------
// V2 Market Phase Helper Functions
// -------------------------------------------------------

function sample(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function troopTotal(troops) {
  return troops.melee + troops.ranged + troops.mounted;
}

function drawRandomDice(game) {
  const pool = [];
  if (game.bag.melee > 0) pool.push('melee');
  if (game.bag.ranged > 0) pool.push('ranged');
  if (game.bag.mounted > 0) pool.push('mounted');
  if (pool.length === 0) return null;
  const type = sample(pool);
  game.bag[type] -= 1;
  return type;
}

function createV2Lots(game) {
  const lotCount = 2 * game.players.length;
  const lots = [];
  
  // Create lots by drawing 3 dice at random from the bag for each lot
  for (let i = 0; i < lotCount; i++) {
    const lot = { melee: 0, ranged: 0, mounted: 0 };
    for (let j = 0; j < 3; j++) {
      const type = drawRandomDice(game);
      if (type) lot[type] += 1;
    }
    lots.push(lot);
  }
  
  return lots;
}

function selectBestV2Lot(lots, player) {
  if (lots.length === 0) return -1;
  
  // Simple AI: select the lot with the most melee troops (prioritize melee)
  let bestIdx = 0;
  let bestScore = -Infinity;
  
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    // Score based on: melee (weight 2), ranged (weight 1.5), mounted (weight 1.5)
    const score = lot.melee * 2 + lot.ranged * 1.5 + lot.mounted * 1.5;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  
  return bestIdx;
}

function playV2MarketPhase(game) {
  // Move all dice from market and supply back to the bag
  game.bag.melee += game.market.melee;
  game.bag.ranged += game.market.ranged;
  game.bag.mounted += game.market.mounted;
  game.market = { melee: 0, ranged: 0, mounted: 0 };
  
  game.bag.melee += game.supply.melee;
  game.bag.ranged += game.supply.ranged;
  game.bag.mounted += game.supply.mounted;
  game.supply = { melee: 0, ranged: 0, mounted: 0 };
  
  addLog(game, 'V2 Market: All dice moved to muster bag.');
  
  // Create lots
  const lots = createV2Lots(game);
  addLog(game, `V2 Market: Created ${lots.length} lots for selection.`);
  
  // Players select in turn order: first selection round (1, 2, 3, 4, ...)
  for (let i = 0; i < game.players.length; i++) {
    const player = game.players[i];
    const bestLotIdx = selectBestV2Lot(lots, player);
    if (bestLotIdx >= 0) {
      const selectedLot = lots[bestLotIdx];
      player.troops.melee += selectedLot.melee;
      player.troops.ranged += selectedLot.ranged;
      player.troops.mounted += selectedLot.mounted;
      lots.splice(bestLotIdx, 1);
      addLog(game, `${player.name} selected a lot (${selectedLot.melee}M, ${selectedLot.ranged}R, ${selectedLot.mounted}Mo).`);
    }
  }
  
  // Players select in reverse turn order: second selection round (4, 3, 2, 1, ...)
  for (let i = game.players.length - 1; i >= 0; i--) {
    const player = game.players[i];
    const bestLotIdx = selectBestV2Lot(lots, player);
    if (bestLotIdx >= 0) {
      const selectedLot = lots[bestLotIdx];
      player.troops.melee += selectedLot.melee;
      player.troops.ranged += selectedLot.ranged;
      player.troops.mounted += selectedLot.mounted;
      lots.splice(bestLotIdx, 1);
      addLog(game, `${player.name} selected a second lot (${selectedLot.melee}M, ${selectedLot.ranged}R, ${selectedLot.mounted}Mo).`);
    }
  }
}

function applyUpkeepV2(game, player) {
  const troopCount = troopTotal(player.troops);
  const upkeepCost = troopCount * 3;
  
  player.money -= upkeepCost;
  addLog(game, `${player.name} paid ${upkeepCost} upkeep (${troopCount} troops @ 3 coin each).`);
}

// -------------------------------------------------------
// V2-wrapped Functions - Override gameEngine exports
// -------------------------------------------------------

export function createGameV2(config = {}) {
  const game = createClassicGame({ ...config, ruleset: 'v2' });
  game.v2MarketDoneThisRound = false;
  return game;
}

export function runAiTurn(game) {
  // For V2 games, use custom turn logic
  if (getRuleset(game) === 'v2') {
    return runAiTurnV2(game);
  }
  // For classic games, use standard logic
  return runClassicAiTurn(game);
}

export function runAiTurnV2(game) {
  if (game.isFinished) return;
  
  // V2 market phase happens once per round at player 1's turn
  if (game.currentPlayerIndex === 0 && !game.v2MarketDoneThisRound) {
    playV2MarketPhase(game);
    game.v2MarketDoneThisRound = true;
  }
  
  // Run the classic AI turn (which includes campaign and muster)
  runClassicAiTurn(game);
  
  // Apply V2 upkeep after the turn
  const player = getActivePlayer(game);
  setTurnPhase(game, 'Upkeep');
  applyUpkeepV2(game, player);
}


export function beginInteractiveTurn(game) {
  // Handle V2 market at player 1's turn before classic interactive turn
  if (getRuleset(game) === 'v2' && game.currentPlayerIndex === 0 && !game.v2MarketDoneThisRound) {
    playV2MarketPhase(game);
    game.v2MarketDoneThisRound = true;
  }
  
  return beginClassicInteractiveTurn(game);
}

export function beginInteractiveTurnV2(game) {
  return beginInteractiveTurn(game);
}

export function humanDrawCard(game, source) {
  // For V2 games, apply upkeep after draw
  const result = classicHumanDrawCard(game, source);
  
  if (result && game.humanState.drawChoicesRemaining <= 0 && getRuleset(game) === 'v2') {
    const player = getActivePlayer(game);
    setTurnPhase(game, 'Upkeep');
    applyUpkeepV2(game, player);
  }
  
  return result;
}

export function autoPlayUntilHumanOrEnd(game) {
  // For V2 games, need to handle market phase specially
  if (getRuleset(game) === 'v2') {
    return autoPlayUntilHumanOrEndV2(game);
  }
  return classicAutoPlayUntilHumanOrEnd(game);
}

function autoPlayUntilHumanOrEndV2(game) {
  while (!game.isFinished) {
    const player = getActivePlayer(game);
    if (game.mode === 'interactive' && player.isHuman) {
      beginInteractiveTurnV2(game);
      break;
    }
    runAiTurnV2(game);
  }
}

export function runMultipleSimulationsV2(config, count) {
  return runClassicMultipleSimulations({ ...config, ruleset: 'v2' }, count);
}
