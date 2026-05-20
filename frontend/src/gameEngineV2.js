import {
  createGame as createClassicGame,
  runMultipleSimulations as runClassicMultipleSimulations,
  runAiTurn as runClassicAiTurn,
  beginInteractiveTurn as beginClassicInteractiveTurn,
  autoPlayUntilHumanOrEnd as classicAutoPlayUntilHumanOrEnd,
  getActivePlayer,
  getRuleset,
  nextPlayer,
  maybeEndGame,
  addLog,
  finishGame,
  economyRulesForGame,
  humanConfirmBattle as humanConfirmBattleClassic,
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

function drawFromV2ContractDeck(game, tier) {
  const deck = game.v2ContractDecks?.[tier];
  if (!deck || deck.length === 0) return null;
  const idx = Math.floor(Math.random() * deck.length);
  const [card] = deck.splice(idx, 1);
  return card || null;
}

function drawFromV2SpecialistDeck(game) {
  const deck = game.v2SpecialistDeck;
  if (!deck || deck.length === 0) return null;
  const idx = Math.floor(Math.random() * deck.length);
  const [card] = deck.splice(idx, 1);
  return card || null;
}

function refreshOfferV2(game) {
  for (const tier of ['A', 'B', 'C']) {
    game.offer[tier] = (game.offer[tier] || []).filter(Boolean);
    const offerCard = drawFromV2ContractDeck(game, tier);
    if (offerCard) game.offer[tier].push(offerCard);
  }
}

function buildV2DecksFromTierDecks(game) {
  const contractDecks = { A: [], B: [], C: [] };
  const specialistDeck = [];

  const allCards = [];

  for (const tier of ['A', 'B', 'C']) {
    allCards.push(...(game.tierDecks?.[tier] || []));
  }

  // Discard any classic starting hand — V2 deals its own starting hands
  for (const player of game.players || []) {
    player.hand = [];
  }

  for (const tier of ['A', 'B', 'C']) {
    allCards.push(...(game.offer?.[tier] || []));
  }

  for (const card of allCards) {
    if (!card) continue;
    if (card.kind === 'contract' && ['A', 'B', 'C'].includes(card.tier)) {
      contractDecks[card.tier].push(card);
    } else if (card.kind === 'specialist') {
      specialistDeck.push(card);
    }
  }

  game.v2ContractDecks = contractDecks;
  game.v2SpecialistDeck = specialistDeck;
}

function drawFromAnyV2ContractDeck(game) {
  const candidates = ['A', 'B', 'C'].filter((tier) => (game.v2ContractDecks?.[tier] || []).length > 0);
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, tier) => sum + game.v2ContractDecks[tier].length, 0);
  let roll = Math.floor(Math.random() * total);
  for (const tier of candidates) {
    const size = game.v2ContractDecks[tier].length;
    if (roll < size) return drawFromV2ContractDeck(game, tier);
    roll -= size;
  }
  return drawFromV2ContractDeck(game, candidates[candidates.length - 1]);
}

function redealV2HandsAndOffer(game) {
  for (const player of game.players || []) {
    player.hand = [];
    for (let i = 0; i < 4; i++) {
      const card = drawFromV2ContractDeck(game, 'A');
      if (!card) break;
      player.hand.push(card);
    }
    const tierBCard = drawFromV2ContractDeck(game, 'B');
    if (tierBCard) player.hand.push(tierBCard);
  }

  game.offer = { A: [], B: [], C: [] };
  for (const tier of ['A', 'B', 'C']) {
    const offerCard = drawFromV2ContractDeck(game, tier);
    if (offerCard) game.offer[tier].push(offerCard);
  }
}

function normalizeInitialOfferForV2(game) {
  for (const tier of ['A', 'B', 'C']) {
    const existing = game.offer?.[tier] || [];
    game.offer[tier] = existing.filter((card) => card && card.kind === 'contract');
    if (game.offer[tier].length === 0) {
      const replacement = drawFromV2ContractDeck(game, tier);
      if (replacement) game.offer[tier].push(replacement);
    }
  }
}

function initializeV2SpecialistMarket(game) {
  const marketSize = game.players?.length || 0;
  game.v2SpecialistMarket = [];

  for (let i = 0; i < marketSize; i++) {
    const specialist = drawFromV2SpecialistDeck(game);
    if (!specialist) break;
    game.v2SpecialistMarket.push(specialist);
  }

  addLog(game, `V2 Specialist Market created with ${game.v2SpecialistMarket.length} specialist(s).`);
}

function topUpV2SpecialistMarket(game) {
  const targetSize = game.players?.length || 0;
  game.v2SpecialistMarket = game.v2SpecialistMarket || [];
  while (game.v2SpecialistMarket.length < targetSize) {
    const specialist = drawFromV2SpecialistDeck(game);
    if (!specialist) break;
    game.v2SpecialistMarket.push(specialist);
  }
}

function initializeV2RecruitPhase(game) {
  topUpV2SpecialistMarket(game);
  game.v2RecruitChoicesByPlayerId = {};
  game.v2RecruitPendingPlayerIndex = undefined;
  game.v2RecruitRoundDone = false;
  addLog(game, `V2 Recruit: Specialist market topped up to ${game.v2SpecialistMarket.length}.`);
}

function initializeV2EquipmentPhase(game) {
  game.v2EquipmentMarket = 2 * (game.players?.length || 0);
  game.v2EquipmentChoicesByPlayerId = {};
  game.v2EquipmentPendingPlayerIndex = undefined;
  game.v2EquipmentRoundDone = false;
  addLog(game, `V2 Equipment Market created with ${game.v2EquipmentMarket} equipment.`);
}

function isV2EquipmentPhaseComplete(game) {
  const choices = game.v2EquipmentChoicesByPlayerId || {};
  const everyoneHadChance = game.players.every((p) => choices[p.id]);
  return everyoneHadChance || (game.v2EquipmentMarket || 0) <= 0;
}

function aiV2PurchaseFromMarketOrPass(game, player) {
  const cost = economyRulesForGame(game).equipmentCost;
  let bought = 0;
  while ((game.v2EquipmentMarket || 0) > 0 && player.money >= cost) {
    player.money -= cost;
    player.equipment = (player.equipment || 0) + 1;
    game.v2EquipmentMarket -= 1;
    bought += 1;
  }
  if (bought > 0) {
    addLog(game, `${player.name} purchased ${bought} equipment from the market.`);
  } else {
    addLog(game, `${player.name} passed equipment purchase.`);
  }
}

function finishV2PostCampaignPhase(game) {
  // Force wrap so advanceRoundPhase exits post-campaign and starts next round.
  game.currentPlayerIndex = game.players.length - 1;
  game.humanState = { needsInput: false, step: null, selectedContractIds: [], drawChoicesRemaining: 0 };
  advanceRoundPhase(game);
}

function resolveV2EquipmentPhaseUntilPause(game) {
  if (!game.v2EquipmentChoicesByPlayerId) {
    initializeV2EquipmentPhase(game);
  }

  for (let i = game.players.length - 1; i >= 0; i -= 1) {
    if ((game.v2EquipmentMarket || 0) <= 0) break;
    const player = game.players[i];
    if (game.v2EquipmentChoicesByPlayerId[player.id]) continue;

    if (player.isHuman) {
      game.v2EquipmentPendingPlayerIndex = i;
      game.humanState.step = 'v2-purchase-equipment';
      game.humanState.needsInput = true;
      return false;
    }

    aiV2PurchaseFromMarketOrPass(game, player);
    game.v2EquipmentChoicesByPlayerId[player.id] = 'resolved';
  }

  if (isV2EquipmentPhaseComplete(game)) {
    game.v2EquipmentRoundDone = true;
    game.v2EquipmentPendingPlayerIndex = undefined;
    addLog(game, 'V2 Equipment: Purchase phase complete.');
    finishV2PostCampaignPhase(game);
    return true;
  }

  return false;
}

function isV2RecruitPhaseComplete(game) {
  const choices = game.v2RecruitChoicesByPlayerId || {};
  return game.players.every((p) => choices[p.id]);
}

function aiV2RecruitFromMarketOrPass(game, player) {
  const retinueSize = (player.retinue || []).length;
  if (retinueSize >= 3) {
    addLog(game, `${player.name} passed recruiting.`);
    return;
  }

  const cost = 2 + retinueSize;
  const market = game.v2SpecialistMarket || [];
  const candidateIdx = market.findIndex((card) => player.money >= cost);
  if (candidateIdx < 0) {
    addLog(game, `${player.name} passed recruiting.`);
    return;
  }

  const [card] = market.splice(candidateIdx, 1);
  player.money -= cost;
  player.retinue = player.retinue || [];
  player.retinue.push(card);
  addLog(game, `${player.name} recruited ${card.title} from the specialist market.`);
}

function resolveV2RecruitPhaseUntilPause(game) {
  if (!game.v2RecruitChoicesByPlayerId) {
    initializeV2RecruitPhase(game);
  }

  for (let i = game.players.length - 1; i >= 0; i -= 1) {
    const player = game.players[i];
    if (game.v2RecruitChoicesByPlayerId[player.id]) continue;

    if (player.isHuman) {
      game.v2RecruitPendingPlayerIndex = i;
      game.humanState.step = 'v2-recruit-specialists';
      game.humanState.needsInput = true;
      return false;
    }

    aiV2RecruitFromMarketOrPass(game, player);
    game.v2RecruitChoicesByPlayerId[player.id] = 'resolved';
  }

  if (isV2RecruitPhaseComplete(game)) {
    game.v2RecruitRoundDone = true;
    game.v2RecruitPendingPlayerIndex = undefined;
    game.humanState.step = 'v2-purchase-equipment';
    game.humanState.needsInput = true;
    addLog(game, 'V2 Recruit: All players have recruited or passed.');
    return true;
  }

  return false;
}

function createV2Lots(game) {
  const lotCount = game.players.length;
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
  return playV2MarketPhaseWithOrder(game, game.players.map((_, idx) => idx), 'round');
}

function playV2MarketPhaseWithOrder(game, selectionOrder, context = 'round') {
  const supplyEquipment = game.supply.equipment ?? 0;

  // Move all dice from market and supply back to the bag
  game.bag.melee += game.market.melee;
  game.bag.ranged += game.market.ranged;
  game.bag.mounted += game.market.mounted;
  game.market = { melee: 0, ranged: 0, mounted: 0 };
  
  game.bag.melee += game.supply.melee;
  game.bag.ranged += game.supply.ranged;
  game.bag.mounted += game.supply.mounted;
  game.supply = { melee: 0, ranged: 0, mounted: 0, equipment: supplyEquipment };
  
  addLog(game, 'V2 Market: All dice moved to muster bag.');
  
  // Create lots
  const lots = createV2Lots(game);
  addLog(game, `V2 Market: Created ${lots.length} lots for selection.`);
  
  // Store lots and selection state in game for interactive mode
  game.v2Lots = lots;
  game.v2LotSelectionOrder = [...selectionOrder];
  game.v2LotSelectionIndex = 0;
  game.v2CurrentLotSelectionPlayerIndex = undefined;
  game.v2LotSelectionContext = context;
  
  // Auto-complete the lot selection phase
  completeV2LotSelection(game);
}

function completeV2LotSelection(game) {
  const lots = game.v2Lots || [];
  const order = game.v2LotSelectionOrder || [];

  while (lots.length > 0 && game.v2LotSelectionIndex < order.length) {
    const playerIndex = order[game.v2LotSelectionIndex];
    const player = game.players[playerIndex];

    if (player.isHuman) {
      game.v2CurrentLotSelectionPlayerIndex = playerIndex;
      if (game.humanState) {
        game.humanState.step = 'v2-lot-selection';
        game.humanState.needsInput = true;
      }
      return;
    }

    const bestLotIdx = selectBestV2Lot(lots, player);
    if (bestLotIdx >= 0) {
      const selectedLot = lots[bestLotIdx];
      player.troops.melee += selectedLot.melee;
      player.troops.ranged += selectedLot.ranged;
      player.troops.mounted += selectedLot.mounted;
      lots.splice(bestLotIdx, 1);
      addLog(game, `${player.name} selected a lot (${selectedLot.melee}M, ${selectedLot.ranged}R, ${selectedLot.mounted}Mo).`);
    }

    game.v2LotSelectionIndex += 1;
  }
  
  // All lots selected, clean up and move to campaign phase
  game.v2Lots = undefined;
  game.v2LotSelectionOrder = undefined;
  game.v2LotSelectionIndex = undefined;
  game.v2CurrentLotSelectionPlayerIndex = undefined;
  const selectionContext = game.v2LotSelectionContext;
  game.v2LotSelectionContext = undefined;
  game.humanState = { needsInput: false, step: null, selectedContractIds: [], drawChoicesRemaining: 0 };

  if (selectionContext === 'pregame') {
    // After pre-game setup lots, keep the game at round-one market.
    game.roundPhase = 'market';
    game.currentPlayerIndex = 0;
    addLog(game, 'V2 pre-game lot selection complete.');
    return;
  }

  // In-round market lot selection transitions into campaign.
  game.roundPhase = 'campaign';
  game.currentPlayerIndex = 0;
  addLog(game, 'campaign phase begins.');
}

// -------------------------------------------------------
// V2 Round Structure: Market → Campaign → Post-Campaign → Rotate
// -------------------------------------------------------

function advanceRoundPhase(game) {
  const n = game.players.length;
  const phases = ['market', 'campaign', 'post-campaign'];
  const currentPhaseIdx = phases.indexOf(game.roundPhase || 'market');
  
  // Move to next player in turn order
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % n;
  
  // If we wrapped back to the start, move to next phase
  if (game.currentPlayerIndex === 0) {
    if (currentPhaseIdx < phases.length - 1) {
      // Move to next phase, reset to first player
      game.roundPhase = phases[currentPhaseIdx + 1];
      game.currentPlayerIndex = 0;
      addLog(game, `${game.roundPhase} phase begins.`);
    } else {
      // All phases complete, rotate first player and start new round
      const first = game.players.shift();
      game.players.push(first);
      game.round += 1;
      game.roundPhase = 'market';
      game.currentPlayerIndex = 0;
      // Reset completed contracts tracker for new round
      game.v2RoundCompletedContracts = { A: 0, B: 0, C: 0 };
      game.v2DraftPool = undefined;
      game.v2DraftIndex = 0;
      game.v2DraftRound = 0;
      game.v2RecruitRoundDone = false;
      game.v2RecruitChoicesByPlayerId = undefined;
      game.v2RecruitPendingPlayerIndex = undefined;
      game.v2EquipmentRoundDone = false;
      game.v2EquipmentChoicesByPlayerId = undefined;
      game.v2EquipmentPendingPlayerIndex = undefined;
      game.v2EquipmentMarket = 0;
      refreshOfferV2(game);
      addLog(game, `Round ${game.round} begins.`);
    }
  }
  
  // Check final round end
  if (game.startedFinalRound && game.v2FinalRoundPlayerId) {
    if (game.players[game.currentPlayerIndex]?.id === game.v2FinalRoundPlayerId) {
      game.isFinished = true;
      finishGame(game);
    }
  }
}

function endPlayerPhaseAction(game) {
  maybeEndGame(game);
  captureV2FinalRoundPlayer(game);
  game.humanState = { needsInput: false, step: null, selectedContractIds: [], drawChoicesRemaining: 0 };
  if (!game.isFinished) advanceRoundPhase(game);
}

// -------------------------------------------------------
// V2 Campaign Completion (replaces beginMuster for V2)
// -------------------------------------------------------

function finishCampaignForV2(game, player) {
  // After campaign battle completes, apply upkeep and move to post-campaign
  const upkeepCost = 2 * (player.troops.melee + player.troops.ranged + player.troops.mounted);
  if (player.money >= upkeepCost) {
    player.money -= upkeepCost;
    addLog(game, `${player.name} paid ${upkeepCost} coins for troop upkeep.`);
  } else {
    addLog(game, `${player.name} couldn't pay full upkeep (${upkeepCost}), paid ${player.money}.`);
    player.money = 0;
  }
  
  // Move to post-campaign
  if (player.isHuman) {
    game.humanState.step = 'v2-draft-contracts';
    game.humanState.needsInput = true;
  } else {
    game.v2PostCampaignPending = true;
  }
}

function initializeDraftPool(game) {
  // Count completed contracts by tier during this round
  if (!game.v2RoundCompletedContracts) {
    game.v2RoundCompletedContracts = { A: 0, B: 0, C: 0 };
  }
  
  // Create draft pool from completed counts - draw from V2 contract decks
  game.v2DraftPool = { A: [], B: [], C: [] };
  for (const tier of ['A', 'B', 'C']) {
    const count = game.v2RoundCompletedContracts[tier] || 0;
    for (let i = 0; i < count; i++) {
      const deck = game.v2ContractDecks?.[tier];
      if (deck && deck.length > 0) {
        const idx = Math.floor(Math.random() * deck.length);
        const [card] = deck.splice(idx, 1);
        game.v2DraftPool[tier].push(card);
      }
    }
  }
  
  // Set up reverse-order draft sequence
  const n = game.players.length;
  game.v2DraftRound = 0;
  game.v2DraftIndex = 0;
  addLog(game, `Draft pool created: A${game.v2DraftPool.A.length} / B${game.v2DraftPool.B.length} / C${game.v2DraftPool.C.length}`);
}

function getDraftPlayerIndex(game) {
  // Reverse order: last player drafts first
  const n = game.players.length;
  const reverseIdx = (n - 1 - game.v2DraftIndex) % n;
  return reverseIdx;
}

function isDraftPhaseOver(game) {
  // Draft ends when pool is empty OR all players have 5+ cards
  const poolEmpty = !game.v2DraftPool || (game.v2DraftPool.A.length === 0 && game.v2DraftPool.B.length === 0 && game.v2DraftPool.C.length === 0);
  if (poolEmpty) return true;
  return game.players.every((p) => p.hand.length >= 5);
}

function advanceDraftIndex(game) {
  const n = game.players.length;
  game.v2DraftIndex = (game.v2DraftIndex + 1) % n;
  if (game.v2DraftIndex === 0) {
    game.v2DraftRound += 1;
  }
}



// --- AI helpers ---

function aiV2DraftContracts(game, player) {
  // Keep drafting until hand has 5 cards or pool is exhausted
  while (player.hand.length < 5 && !isDraftPhaseOver(game)) {
    let drafted = false;
    for (const tier of ['A', 'B', 'C']) {
      if (game.v2DraftPool[tier] && game.v2DraftPool[tier].length > 0) {
        const card = game.v2DraftPool[tier].shift();
        player.hand.push(card);
        addLog(game, `${player.name} drafted a ${tier}-tier contract.`);
        drafted = true;
        advanceDraftIndex(game);
        break;
      }
    }
    if (!drafted) break;
    if (!isDraftPhaseOver(game)) {
      const nextIdx = getDraftPlayerIndex(game);
      if (nextIdx === game.players.indexOf(player)) {
        continue;
      } else {
        break;
      }
    }
  }
}

function aiV2RecruitSpecialists() {}

function aiV2PurchaseEquipment() {}

function runAiV2PostCampaignPhases(game) {
  const player = getActivePlayer(game);
  if (game.humanState.step === 'v2-draft-contracts') {
    aiV2DraftContracts(game, player);
    if (isDraftPhaseOver(game)) {
      game.humanState.step = 'v2-recruit-specialists';
    } else {
      advanceDraftIndex(game);
      return;
    }
  }
  if (game.humanState.step === 'v2-recruit-specialists' && !game.v2RecruitRoundDone) {
    const completed = resolveV2RecruitPhaseUntilPause(game);
    if (!completed) return;
  }
  if (game.humanState.step === 'v2-purchase-equipment' && !game.v2EquipmentRoundDone) {
    resolveV2EquipmentPhaseUntilPause(game);
    return;
  }
}

// --- Human action exports ---

export function humanV2DraftContract(game, tier) {
  if (game.humanState.step !== 'v2-draft-contracts') return false;
  if (!game.v2DraftPool[tier] || game.v2DraftPool[tier].length === 0) return false;
  const player = getActivePlayer(game);
  const card = game.v2DraftPool[tier].shift();
  player.hand.push(card);
  addLog(game, `${player.name} drafted a ${tier}-tier contract.`);
  advanceDraftIndex(game);
  if (isDraftPhaseOver(game)) {
    game.humanState.step = 'v2-recruit-specialists';
  } else {
    const nextIdx = getDraftPlayerIndex(game);
    const nextPlayer = game.players[nextIdx];
    if (nextPlayer.isHuman) {
      game.humanState.needsInput = true;
    } else {
      autoPlayUntilHumanOrEndV2(game);
      return true;
    }
  }
  return true;
}

export function humanV2SkipDraftContracts(game) {
  if (game.humanState.step !== 'v2-draft-contracts') return false;
  const player = getActivePlayer(game);
  addLog(game, `${player.name} skipped drafting.`);
  advanceDraftIndex(game);
  if (isDraftPhaseOver(game)) {
    game.humanState.step = 'v2-recruit-specialists';
  } else {
    const nextIdx = getDraftPlayerIndex(game);
    const nextPlayer = game.players[nextIdx];
    if (nextPlayer.isHuman) {
      game.humanState.needsInput = true;
    } else {
      autoPlayUntilHumanOrEndV2(game);
      return true;
    }
  }
  return true;
}

export function humanV2RecruitSpecialist(game, cardId) {
  if (game.humanState.step !== 'v2-recruit-specialists') return false;
  const pendingIdx = game.v2RecruitPendingPlayerIndex;
  if (pendingIdx === undefined || pendingIdx === null) return false;
  const player = game.players[pendingIdx];
  if (!player || !player.isHuman) return false;
  if ((player.retinue || []).length >= 3) return false;
  const card = (game.v2SpecialistMarket || []).find((c) => c.id === cardId && c.kind === 'specialist');
  if (!card) return false;
  const cost = 2 + (player.retinue || []).length;
  if (player.money < cost) return false;
  player.money -= cost;
  player.retinue = player.retinue || [];
  player.retinue.push(card);
  game.v2SpecialistMarket = (game.v2SpecialistMarket || []).filter((c) => c.id !== card.id);
  game.v2RecruitChoicesByPlayerId = game.v2RecruitChoicesByPlayerId || {};
  game.v2RecruitChoicesByPlayerId[player.id] = 'recruited';
  game.v2RecruitPendingPlayerIndex = undefined;
  addLog(game, `${player.name} recruited specialist ${card.title} from the specialist market.`);
  resolveV2RecruitPhaseUntilPause(game);
  return true;
}

export function humanV2SkipRecruitSpecialists(game) {
  if (game.humanState.step !== 'v2-recruit-specialists') return false;
  const pendingIdx = game.v2RecruitPendingPlayerIndex;
  if (pendingIdx === undefined || pendingIdx === null) return false;
  const player = game.players[pendingIdx];
  if (!player || !player.isHuman) return false;
  game.v2RecruitChoicesByPlayerId = game.v2RecruitChoicesByPlayerId || {};
  game.v2RecruitChoicesByPlayerId[player.id] = 'passed';
  game.v2RecruitPendingPlayerIndex = undefined;
  addLog(game, `${player.name} passed recruiting.`);
  resolveV2RecruitPhaseUntilPause(game);
  return true;
}

export function humanV2PurchaseEquipment(game) {
  if (game.humanState.step !== 'v2-purchase-equipment') return false;
  const pendingIdx = game.v2EquipmentPendingPlayerIndex;
  if (pendingIdx === undefined || pendingIdx === null) return false;
  const player = game.players[pendingIdx];
  if (!player || !player.isHuman) return false;
  const cost = economyRulesForGame(game).equipmentCost;
  if ((game.v2EquipmentMarket || 0) <= 0) return false;
  if (player.money < cost) return false;
  player.money -= cost;
  player.equipment = (player.equipment || 0) + 1;
  game.v2EquipmentMarket -= 1;
  addLog(game, `${player.name} purchased equipment from the market.`);

  if ((game.v2EquipmentMarket || 0) <= 0) {
    game.v2EquipmentChoicesByPlayerId = game.v2EquipmentChoicesByPlayerId || {};
    game.v2EquipmentChoicesByPlayerId[player.id] = 'resolved';
    game.v2EquipmentPendingPlayerIndex = undefined;
    resolveV2EquipmentPhaseUntilPause(game);
  }

  return true;
}

export function humanV2DonePurchasingEquipment(game) {
  if (game.humanState.step !== 'v2-purchase-equipment') return false;
  const pendingIdx = game.v2EquipmentPendingPlayerIndex;
  if (pendingIdx === undefined || pendingIdx === null) return false;
  const player = game.players[pendingIdx];
  if (!player || !player.isHuman) return false;
  game.v2EquipmentChoicesByPlayerId = game.v2EquipmentChoicesByPlayerId || {};
  game.v2EquipmentChoicesByPlayerId[player.id] = 'resolved';
  game.v2EquipmentPendingPlayerIndex = undefined;
  addLog(game, `${player.name} passed equipment purchase.`);
  resolveV2EquipmentPhaseUntilPause(game);
  return true;
}



export function createGameV2(config = {}) {
  const game = createClassicGame({ ...config, ruleset: 'v2' });

  // V2 uses dedicated decks: contracts split by tier + one specialist deck; events ignored.
  buildV2DecksFromTierDecks(game);
  initializeV2SpecialistMarket(game);
  redealV2HandsAndOffer(game);
  normalizeInitialOfferForV2(game);

  // V2 starts with no money, no troops, and one equipment per player.
  for (const player of game.players) {
    player.money = 0;
    player.troops = { melee: 0, ranged: 0, mounted: 0 };
    player.equipment = 1;
  }

  // Run a pre-game market lot phase in reverse player order.
  const reverseOrder = game.players.map((_, idx) => game.players.length - 1 - idx);
  playV2MarketPhaseWithOrder(game, reverseOrder, 'pregame');

  // Keep turn market pending so round 1 still runs its own market phase.
  game.v2MarketDoneThisRound = false;
  game.roundPhase = 'market';
  game.roundStartIndex = 0;
  game.v2FinalRound = undefined;
  game.v2RecruitRoundDone = false;
  game.v2RecruitChoicesByPlayerId = undefined;
  game.v2RecruitPendingPlayerIndex = undefined;
  game.v2EquipmentRoundDone = false;
  game.v2EquipmentChoicesByPlayerId = undefined;
  game.v2EquipmentPendingPlayerIndex = undefined;
  game.v2EquipmentMarket = 0;
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
  
  const phase = game.roundPhase || 'market';
  const player = getActivePlayer(game);
  
  if (phase === 'market') {
    // Market phase: create lots once at round start, then each player selects
    if (!game.v2Lots) {
      playV2MarketPhase(game);
    }
    // AI selects a lot
    if (game.v2Lots && game.v2Lots.length > 0) {
      const bestLotIdx = selectBestV2Lot(game.v2Lots, player);
      if (bestLotIdx >= 0) {
        const selectedLot = game.v2Lots[bestLotIdx];
        player.troops.melee += selectedLot.melee;
        player.troops.ranged += selectedLot.ranged;
        player.troops.mounted += selectedLot.mounted;
        game.v2Lots.splice(bestLotIdx, 1);
        addLog(game, `${player.name} selected a lot (${selectedLot.melee}M, ${selectedLot.ranged}R, ${selectedLot.mounted}Mo).`);
      }
    }
    advanceRoundPhase(game);
  } else if (phase === 'campaign') {
    // Campaign phase: run campaign without calling classic turn system
    // First do upkeep
    const troopCount = player.troops.melee + player.troops.ranged + player.troops.mounted;
    const upkeepCost = 2 * troopCount;
    if (player.money >= upkeepCost) {
      player.money -= upkeepCost;
      addLog(game, `${player.name} paid ${upkeepCost} coins for troop upkeep.`);
    } else {
      addLog(game, `${player.name} couldn't afford full upkeep (${upkeepCost}), paid ${player.money}.`);
      player.money = 0;
    }
    
    // Select contracts (simplified: take first 1-2 affordable contracts)
    const affordableContracts = player.hand.filter((c) => c.kind === 'contract').slice(0, 1);
    if (affordableContracts.length > 0) {
      // Simulate running the campaign (simplified - just mark them as completed)
      if (!game.v2RoundCompletedContracts) {
        game.v2RoundCompletedContracts = { A: 0, B: 0, C: 0 };
      }
      for (const contract of affordableContracts) {
        player.money += contract.coins;
        player.scorePile.push(contract);
        player.hand = player.hand.filter((c) => c.id !== contract.id);
        // Track completion by tier
        game.v2RoundCompletedContracts[contract.tier] += 1;
        addLog(game, `${player.name} completed ${contract.title}.`);
      }
    }
    
    // Move to post-campaign
    game.humanState.selectedContractIds = [];
    advanceRoundPhase(game);
  } else if (phase === 'post-campaign') {
    // Post-campaign phase: AI draft/recruit/purchase
    runAiV2PostCampaignPhases(game);
  }
}


export function humanConfirmBattle(game) {
  // Override for V2: end with post-campaign instead of muster
  if (getRuleset(game) === 'v2') {
    return humanConfirmBattleV2(game);
  }
  // Use classic version for classic games
  return humanConfirmBattleClassic(game);
}

function humanConfirmBattleV2(game) {
  const player = getActivePlayer(game);
  if (game.humanState.step !== 'battle') return false;
  
  // Use the classic battle logic to resolve the current battle
  humanConfirmBattleClassic(game);
  
  // After classic function, check if more battles remain
  const pb = game.humanState.pendingBattle;
  if (!pb) {
    // No more battles - campaign complete, move to post-campaign
    finishCampaignForV2(game, player);
  }
  
  return true;
}

export function beginInteractiveTurn(game) {
  return beginInteractiveTurnV2(game);
}

export function beginInteractiveTurnV2(game) {
  const phase = game.roundPhase || 'market';
  const player = getActivePlayer(game);
  
  if (phase === 'market') {
    if (!game.v2Lots) {
      playV2MarketPhase(game);
    }
  } else if (phase === 'campaign') {
    game.humanState.step = 'campaign';
    game.humanState.selectedContractIds = [];
  } else if (phase === 'post-campaign') {
    if (!game.v2DraftPool) {
      initializeDraftPool(game);
    }
    if (isDraftPhaseOver(game)) {
      if (!game.v2RecruitRoundDone) {
        resolveV2RecruitPhaseUntilPause(game);
      } else {
        resolveV2EquipmentPhaseUntilPause(game);
      }
    } else {
      const nextIdx = getDraftPlayerIndex(game);
      const nextPlayer = game.players[nextIdx];
      if (nextPlayer === player && player.isHuman) {
        game.humanState.step = 'v2-draft-contracts';
        game.humanState.needsInput = true;
      }
    }
  }
}

export function humanSelectV2Lot(game, lotIndex) {
  if (game.humanState.step !== 'v2-lot-selection' || !game.v2Lots || lotIndex < 0 || lotIndex >= game.v2Lots.length) {
    return false;
  }
  
  const playerIndex = game.v2CurrentLotSelectionPlayerIndex;
  const player = game.players[playerIndex];
  const selectedLot = game.v2Lots[lotIndex];
  
  // Apply lot to player
  player.troops.melee += selectedLot.melee;
  player.troops.ranged += selectedLot.ranged;
  player.troops.mounted += selectedLot.mounted;
  
  addLog(game, `${player.name} selected a lot (${selectedLot.melee}M, ${selectedLot.ranged}R, ${selectedLot.mounted}Mo).`);
  
  // Remove lot from available lots
  game.v2Lots.splice(lotIndex, 1);
  game.v2LotSelectionIndex += 1;
  
  // Continue with next player
  completeV2LotSelection(game);
  
  return true;
}

export function autoPlayUntilHumanOrEnd(game) {
  // For V2 games, need to handle market phase specially
  if (getRuleset(game) === 'v2') {
    return autoPlayUntilHumanOrEndV2(game);
  }
  return classicAutoPlayUntilHumanOrEnd(game);
}

function autoPlayUntilHumanOrEndV2(game) {
  const humanSteps = ['v2-lot-selection', 'v2-draft-contracts', 'v2-recruit-specialists', 'v2-purchase-equipment'];
  while (!game.isFinished) {
    if (game.mode === 'interactive' && humanSteps.includes(game.humanState?.step) && game.humanState.needsInput) {
      return;
    }

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
