import { CONTRACT_CARDS } from './contractsData';
import { SPECIALIST_CARDS } from './specialistsData';
import { isSacrificeEligibleRoll } from './contractResolution';
import { createBattleRuntime } from './battleRuntime';

const SET_SCORES = {
  1: 0,
  2: 1,
  3: 3,
  4: 6,
  5: 10,
  6: 15,
};

const END_GAME_CONTRACT_TARGET = 10;
const MAX_SIM_TURNS = 50;
const SIM_HARD_SAFETY = 2000;

const RULESET_CLASSIC = 'classic';
const RULESET_V2 = 'v2';

const ECONOMY_RULES = {
  [RULESET_CLASSIC]: {
    troopCosts: {
      market: { melee: 2, ranged: 3, mounted: 4 },
      supply: { melee: 4, ranged: 6, mounted: 8 },
    },
    equipmentCost: 1,
    specialistHireSurcharge: 0,
    loanAmount: 10,
  },
  [RULESET_V2]: {
    troopCosts: {
      market: { melee: 3, ranged: 4, mounted: 5 },
      supply: { melee: 5, ranged: 7, mounted: 9 },
    },
    equipmentCost: 2,
    specialistHireSurcharge: 1,
    loanAmount: 6,
  },
};

const AI_MARKET_MODELS = [
  {
    id: 'aggressive',
    renownWeight: 7.8,
    coinWeight: 1.1,
    setPotentialWeight: 1.0,
    huntPotentialWeight: 1.2,
    campaignCostWeight: 0.8,
    troopCostWeight: 0.55,
    debtPenaltyWeight: 0.65,
    loanThreshold: 0.4,
  },
  {
    id: 'forward',
    renownWeight: 6.9,
    coinWeight: 1.0,
    setPotentialWeight: 0.9,
    huntPotentialWeight: 1.0,
    campaignCostWeight: 1.0,
    troopCostWeight: 0.75,
    debtPenaltyWeight: 0.85,
    loanThreshold: 0.8,
  },
  {
    id: 'steady',
    renownWeight: 6.0,
    coinWeight: 1.0,
    setPotentialWeight: 0.8,
    huntPotentialWeight: 0.9,
    campaignCostWeight: 1.1,
    troopCostWeight: 0.95,
    debtPenaltyWeight: 1.0,
    loanThreshold: 1.0,
  },
  {
    id: 'conservative',
    renownWeight: 5.1,
    coinWeight: 1.0,
    setPotentialWeight: 0.7,
    huntPotentialWeight: 0.8,
    campaignCostWeight: 1.25,
    troopCostWeight: 1.2,
    debtPenaltyWeight: 1.25,
    loanThreshold: 1.3,
  },
];

const DEFAULT_AI_MARKET_MODEL = AI_MARKET_MODELS[2];

function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sample(list) {
  return list[rand(0, list.length - 1)];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rand(0, i);
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

function emptyTroops() {
  return { melee: 0, ranged: 0, mounted: 0 };
}

function cloneTroops(troops) {
  return { melee: troops.melee, ranged: troops.ranged, mounted: troops.mounted };
}

function troopTotal(troops) {
  return troops.melee + troops.ranged + troops.mounted;
}

function addTroops(target, source) {
  target.melee += source.melee || 0;
  target.ranged += source.ranged || 0;
  target.mounted += source.mounted || 0;
}

function getRuleset(game) {
  const ruleset = game?.ruleset || RULESET_CLASSIC;
  return ECONOMY_RULES[ruleset] ? ruleset : RULESET_CLASSIC;
}

function economyRulesForGame(game) {
  return ECONOMY_RULES[getRuleset(game)];
}

function troopCostsForGame(game) {
  return economyRulesForGame(game).troopCosts;
}

function specialistHireCost(game, card) {
  return card.cost + economyRulesForGame(game).specialistHireSurcharge;
}

function loanAmountForGame(game) {
  return economyRulesForGame(game).loanAmount;
}

function applyTurnIncome(game, player) {
  if (getRuleset(game) !== RULESET_V2) return;

  const contractCountBonus = Math.min(3, Math.floor(player.scorePile.length / 2));
  const typeDiversity = new Set(player.scorePile.map((card) => card.type)).size;
  const diversityBonus = Math.min(2, typeDiversity);
  const income = Math.max(0, 3 + contractCountBonus + diversityBonus - player.debts);

  player.money += income;
  addEffect(game, 'Income', `${player.name} gained ${income} income.`);
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

function applyUpkeepV2(game, player) {
  if (getRuleset(game) !== RULESET_V2) return;
  
  const troopCount = troopTotal(player.troops);
  const upkeepCost = troopCount * 3;
  
  player.money -= upkeepCost;
  addEffect(game, 'Upkeep', `${player.name} paid ${upkeepCost} upkeep (${troopCount} troops @ 3 coin each).`);
}

function modelForSeat(playerIndex, playerCount) {
  if (playerCount <= 1) return AI_MARKET_MODELS[0];
  const maxIdx = AI_MARKET_MODELS.length - 1;
  const scaled = Math.round((playerIndex * maxIdx) / (playerCount - 1));
  return AI_MARKET_MODELS[Math.max(0, Math.min(maxIdx, scaled))];
}

function modelById(id) {
  if (!id) return null;
  return AI_MARKET_MODELS.find((model) => model.id === id) || null;
}

function assignAiModels(players, config) {
  const hasHuman = (config.humanPlayers || 0) > 0;
  const isBatch = Boolean(config.batchSimulation);
  const selectedBatchModels = Array.isArray(config.aiModels) ? config.aiModels : null;

  for (let i = 0; i < players.length; i += 1) {
    const player = players[i];
    if (player.isHuman) {
      player.aiModel = null;
      continue;
    }

    if (isBatch) {
      // Batch: allow explicit per-seat model selection.
      const selected = selectedBatchModels ? modelById(selectedBatchModels[i]) : null;
      if (selected) {
        player.aiModel = selected;
      } else if (selectedBatchModels) {
        player.aiModel = DEFAULT_AI_MARKET_MODEL;
      } else {
        // Backward-compatible fallback if batch config does not provide explicit model picks.
        player.aiModel = modelForSeat(i, players.length);
      }
    } else if (hasHuman) {
      // Human games: random AI model once at game start.
      player.aiModel = sample(AI_MARKET_MODELS);
    } else {
      player.aiModel = DEFAULT_AI_MARKET_MODEL;
    }
  }
}

function canAfford(player, amount) {
  return player.money >= amount;
}

const MAIN_TIERS = ['A', 'B', 'C'];

function countKindInTierDeck(deck, kind) {
  if (kind === 'any') return deck.length;
  return deck.reduce((sum, card) => sum + (card.kind === kind ? 1 : 0), 0);
}

function pickTierForKind(game, kind, preferredTier = null) {
  if (preferredTier && MAIN_TIERS.includes(preferredTier)) {
    const preferredCount = countKindInTierDeck(game.tierDecks[preferredTier], kind);
    if (preferredCount > 0) return preferredTier;
  }

  const candidates = [];
  let total = 0;
  for (const tier of MAIN_TIERS) {
    const count = countKindInTierDeck(game.tierDecks[tier], kind);
    if (count > 0) {
      candidates.push({ tier, count });
      total += count;
    }
  }
  if (total === 0) return null;

  let roll = rand(1, total);
  for (const candidate of candidates) {
    roll -= candidate.count;
    if (roll <= 0) return candidate.tier;
  }
  return candidates[candidates.length - 1].tier;
}

function drawKindFromTier(game, tier, kind) {
  const deck = game.tierDecks[tier];
  const index = deck.findIndex((card) => card.kind === kind);
  if (index < 0) return null;
  return deck.splice(index, 1)[0];
}

function allMainTierContracts(game) {
  const cards = [];
  for (const tier of MAIN_TIERS) {
    for (const card of game.tierDecks[tier]) {
      if (card.kind === 'contract') cards.push(card);
    }
  }
  return cards;
}

function removeContractFromMainTiers(game, contractId) {
  for (const tier of MAIN_TIERS) {
    const index = game.tierDecks[tier].findIndex((card) => card.kind === 'contract' && card.id === contractId);
    if (index >= 0) {
      return game.tierDecks[tier].splice(index, 1)[0];
    }
  }
  return null;
}

function drawContractFromTopN(game, count, chooser) {
  const contracts = allMainTierContracts(game);
  const take = Math.min(count, contracts.length);
  if (take <= 0) return null;

  const pool = shuffle(contracts).slice(0, take);
  const pickedIndex = Math.max(0, Math.min(pool.length - 1, chooser(pool)));
  const picked = pool.splice(pickedIndex, 1)[0];
  return removeContractFromMainTiers(game, picked.id);
}

function drawBestContractFromTopN(game, count) {
  return drawContractFromTopN(game, count, (pool) => {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const score = pool[i].renown * 2 + pool[i].coins;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  });
}

function countFace(rolls, face) {
  let count = 0;
  for (const type of ['melee', 'ranged', 'mounted']) {
    for (const roll of rolls[type]) {
      if (roll === face) count += 1;
    }
  }
  return count;
}

function hasSpecialist(player, name) {
  return player.retinue.some((card) => card.name === name);
}

function countSpecialist(player, name) {
  return player.retinue.filter((card) => card.name === name).length;
}

function gainEquipment(game, player, amount) {
  let gain = Math.min(amount, game.armoury);
  game.armoury -= gain;

  if (gain > 0 && hasSpecialist(player, 'Runaway Apprentice') && game.armoury > 0) {
    gain += 1;
    game.armoury -= 1;
  }

  player.equipment += gain;
  return gain;
}

function gainElite(game, player, amount) {
  const gain = Math.min(amount, game.supply.elite);
  game.supply.elite -= gain;
  player.elite += gain;
  return gain;
}

function applyContractCompletionEffect(game, player, contract) {
  const text = (contract.completionEffect || '').toLowerCase();
  if (!text.includes('when completed')) {
    return;
  }

  let gainedElite = 0;
  let gainedEquipment = 0;

  if (text.includes('gain 2 elite')) {
    gainedElite = gainElite(game, player, 2);
  } else if (text.includes('gain 1 elite')) {
    gainedElite = gainElite(game, player, 1);
  }

  if (text.includes('2 equipment')) {
    gainedEquipment = gainEquipment(game, player, 2);
  }

  if (gainedElite > 0 || gainedEquipment > 0) {
    player.rewardsTriggered += 1;
    const parts = [];
    if (gainedElite > 0) parts.push(`${gainedElite} elite`);
    if (gainedEquipment > 0) parts.push(`${gainedEquipment} equipment`);
    addEffect(game, `Tier R reward: ${player.name} gained ${parts.join(' and ')} from ${contract.title}.`);
  }
}

function recruitFromSupplyAtMarketCost(game, player, type, amount, unitCost) {
  let recruited = 0;
  for (let i = 0; i < amount; i += 1) {
    if (game.supply[type] <= 0 || player.money < unitCost) break;
    game.supply[type] -= 1;
    player.troops[type] += 1;
    player.money -= unitCost;
    recruited += 1;
  }
  return recruited;
}

function findBestContractByType(game, type) {
  let bestTier = null;
  let bestIndex = -1;
  let bestScore = -Infinity;

  for (const tier of MAIN_TIERS) {
    const deck = game.tierDecks[tier];
    for (let i = 0; i < deck.length; i += 1) {
      const card = deck[i];
      if (card.kind !== 'contract' || card.type !== type) continue;
      const score = card.renown * 2 + card.coins;
      if (score > bestScore) {
        bestScore = score;
        bestTier = tier;
        bestIndex = i;
      }
    }
  }

  if (!bestTier) return null;
  return game.tierDecks[bestTier].splice(bestIndex, 1)[0];
}

function removeSpecialistFromRetinue(player, specialistId) {
  player.retinue = player.retinue.filter((s) => s.id !== specialistId);
}

function applySpecialistOnHire(game, player, card) {
  if (card.name === 'Blacksmith' || card.name === 'Carpenter') {
    const gained = gainEquipment(game, player, 2);
    if (gained > 0) addEffect(game, `${player.name} used ${card.name} and gained ${gained} equipment.`);
  }

  if (card.name === 'Former Stablehand') {
    const recruited = recruitFromSupplyAtMarketCost(game, player, 'mounted', 2, 4);
    if (recruited > 0) addEffect(game, `${player.name} used Former Stablehand to recruit ${recruited} mounted from supply.`);
  }

  if (card.name === 'Dockside Thug') {
    const recruited = recruitFromSupplyAtMarketCost(game, player, 'melee', 2, 2);
    if (recruited > 0) addEffect(game, `${player.name} used Dockside Thug to recruit ${recruited} melee from supply.`);
  }

  if (card.name === 'Roadside Ruffian') {
    const recruited = recruitFromSupplyAtMarketCost(game, player, 'ranged', 2, 3);
    if (recruited > 0) addEffect(game, `${player.name} used Roadside Ruffian to recruit ${recruited} ranged from supply.`);
  }

  if (card.name === 'Negotiator') {
    const replacement = drawBestContractFromTopN(game, 5);
    if (replacement) {
      const contracts = player.hand.filter((c) => c.kind === 'contract');
      if (contracts.length > 0) {
        contracts.sort((a, b) => (a.renown + a.coins) - (b.renown + b.coins));
        const removeId = contracts[0].id;
        player.hand = player.hand.filter((c) => c.id !== removeId);
      }
      player.hand.push(replacement);
      addEffect(game, `${player.name} used Negotiator to find a stronger contract.`);
    }
  }

  if (card.name === 'Fence') {
    if (player.equipment > 0) {
      player.equipment -= 1;
      game.armoury += 1;
      player.money += 5;
      addEffect(game, `${player.name} used Fence: traded 1 equipment for 5 coins.`);
    }
  }

  if (card.name === 'Informer') {
    const eventCard = drawFromDeck(game, 'event');
    if (eventCard) {
      player.hand.push(eventCard);
      addEffect(game, `${player.name} used Informer to gain an event card.`);
    }
  }

  if (card.name === 'Spy') {
    const found = findBestContractByType(game, 'devastate');
    if (found) {
      player.hand.push(found);
      addEffect(game, `${player.name} used Spy to find a DEVASTATE contract.`);
    }
  }

  if (card.name === 'Trader') {
    const found = findBestContractByType(game, 'supply');
    if (found) {
      player.hand.push(found);
      addEffect(game, `${player.name} used Trader to find a SUPPLY contract.`);
    }
  }

  if (card.condition === 'Discard') {
    removeSpecialistFromRetinue(player, card.id);
    addEffect(game, `${player.name} discarded ${card.name} after use.`);
  }
}

function createLoadedContract(template, idPrefix = 'contract') {
  return {
    id: uid(idPrefix),
    kind: 'contract',
    title: template.title,
    type: template.type,
    region: template.region,
    requirements: cloneTroops(template.requirements),
    renown: 0,
    coins: template.coins + (template.renown * 3),
    tier: template.tier,
    cardNumber: template.cardNumber,
    completionEffect: template.completionEffect || '',
  };
}

function createTierDecks(includeEvents = true) {
  const tierDecks = { A: [], B: [], C: [] };

  for (const template of CONTRACT_CARDS) {
    if (!MAIN_TIERS.includes(template.tier)) continue;
    for (let i = 0; i < template.copies; i += 1) {
      tierDecks[template.tier].push(createLoadedContract(template));
    }
  }

  for (const template of SPECIALIST_CARDS) {
    if (!MAIN_TIERS.includes(template.tier)) continue;
    for (let i = 0; i < template.copies; i += 1) {
      tierDecks[template.tier].push({
        id: uid('specialist'),
        kind: 'specialist',
        name: template.name,
        tier: template.tier,
        cost: template.cost,
        condition: template.condition,
        effect: template.effect,
      });
    }
  }

  if (includeEvents) {
    for (const template of EVENT_CARDS) {
      if (!MAIN_TIERS.includes(template.tier)) continue;
      for (let i = 0; i < template.copies; i += 1) {
        tierDecks[template.tier].push({
          id: uid('event'),
          kind: 'event',
          name: template.name,
          tier: template.tier,
          whenPlayed: { ...template.whenPlayed },
          ongoing: { ...template.ongoing },
          roundEnd: template.roundEnd || null,
        });
      }
    }
  }

  for (const tier of MAIN_TIERS) {
    tierDecks[tier] = shuffle(tierDecks[tier]);
  }

  return tierDecks;
}

const EVENT_CARDS = [
  // Tier A
  {
    name: 'Archery Contest', tier: 'A', copies: 1,
    whenPlayed: { drawCard: true, addToBag: { ranged: 3 } },
    ongoing: {},
    roundEnd: null,
  },
  {
    name: 'War Spoils', tier: 'A', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { contractBonus: { type: 'plunder', coins: 4 } },
    roundEnd: null,
  },
  {
    name: 'Open Season', tier: 'A', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: {},
    roundEnd: 'openSeasonReward',
  },
  {
    name: 'Abducted Children', tier: 'A', copies: 1,
    whenPlayed: { drawCard: true, gainCoins: 3 },
    ongoing: {},
    roundEnd: null,
  },
  // Tier B
  {
    name: 'Bread & Games', tier: 'B', copies: 1,
    whenPlayed: { drawCard: true, addToBag: { melee: 3, ranged: 3, mounted: 3 } },
    ongoing: { marketDrawDelta: 2 },
    roundEnd: null,
  },
  {
    name: 'Ceremonial Season', tier: 'B', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { contractBonus: { type: 'supply', coins: 4 } },
    roundEnd: null,
  },
  {
    name: 'Bandit Trouble', tier: 'B', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { contractBonus: { type: 'eliminate', coins: 4 } },
    roundEnd: null,
  },
  {
    name: 'Good Harvest', tier: 'B', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { campaignCostDelta: -3 },
    roundEnd: null,
  },
  {
    name: 'Local Holiday', tier: 'B', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { endOfTurnDrawBonus: 1 },
    roundEnd: null,
  },
  {
    name: 'Ambushed Trade Routes', tier: 'B', copies: 1,
    whenPlayed: { drawCard: true, gainCoins: 3 },
    ongoing: { marketDrawDelta: -1 },
    roundEnd: null,
  },
  // Tier C
  {
    name: 'High Spirits', tier: 'C', copies: 1,
    whenPlayed: { drawCard: true, addToBag: { melee: 2, mounted: 2 }, gainEquipmentAll: 1 },
    ongoing: { marketDrawDelta: 1 },
    roundEnd: null,
  },
  {
    name: 'Lands Besieged', tier: 'C', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { contractBonus: { type: 'guard', coins: 4 }, guardFreeToAdd: true },
    roundEnd: 'landsBesiegedReward',
  },
  {
    name: 'Opportunism', tier: 'C', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { contractBonus: { type: 'devastate', coins: 2 }, devastateFreeToAdd: true },
    roundEnd: 'opportunismReward',
  },
  {
    name: 'Cultist Procession', tier: 'C', copies: 1,
    whenPlayed: { addToBagFromSupply: { melee: 4 } },
    ongoing: { meleeWildsDisabled: true },
    roundEnd: 'cultistReward',
  },
  {
    name: 'The Tilt Run', tier: 'C', copies: 1,
    whenPlayed: { drawCard: true, addToBag: { mounted: 3 } },
    ongoing: {},
    roundEnd: 'tiltRun',
  },
  {
    name: 'A Royal Audience', tier: 'C', copies: 1,
    whenPlayed: { drawCard: true, gainCoins: 3 },
    ongoing: {},
    roundEnd: 'royalAuction',
  },
];

function createEventDeck() {
  const cards = [];
  for (const template of EVENT_CARDS) {
    for (let i = 0; i < template.copies; i += 1) {
      cards.push({
        id: uid('event'),
        kind: 'event',
        name: template.name,
        tier: template.tier,
        whenPlayed: { ...template.whenPlayed },
        ongoing: { ...template.ongoing },
        roundEnd: template.roundEnd || null,
      });
    }
  }
  return shuffle(cards);
}

function createRewardsDeck() {
  const cards = [];
  for (const template of CONTRACT_CARDS) {
    if (template.tier !== 'R') continue;
    for (let i = 0; i < template.copies; i += 1) {
      cards.push(createLoadedContract(template, 'reward-contract'));
    }
  }
  return shuffle(cards);
}

function newPlayer(name, isHuman) {
  return {
    id: uid('player'),
    name,
    isHuman,
    money: 10,
    debts: 0,
    troops: { melee: 1, ranged: 0, mounted: 0 },
    equipment: 1,
    elite: 0,
    rewardsTriggered: 0,
    retinue: [],
    hand: [],
    eventInPlay: null,
    scorePile: [],
    aiModel: null,
    turnsTaken: 0,
    campaignsRun: 0,
    totalContractsSelected: 0,
  };
}

function drawFromDeck(game, kind, options = {}) {
  if (kind === 'rewardContract' || (kind === 'contract' && options.rewardOnly)) {
    return game.rewardsDeck.shift() || null;
  }

  if (kind === 'any') {
    const tier = pickTierForKind(game, 'any', options.preferredTier || null);
    if (!tier) return null;
    return game.tierDecks[tier].shift() || null;
  }

  if (kind === 'contract' || kind === 'specialist' || kind === 'event') {
    const tier = pickTierForKind(game, kind, options.preferredTier || null);
    if (!tier) return null;
    return drawKindFromTier(game, tier, kind);
  }

  return null;
}

export function contractCost(contracts, discount = 0) {
  if (contracts.length <= 1) return 0;
  let cost = contracts.length === 2 ? 2 : 5;

  for (let i = 1; i < contracts.length; i += 1) {
    if (contracts[i].region !== contracts[i - 1].region) {
      cost += 3;
    }
  }

  return Math.max(0, cost - discount);
}

function addLog(game, text) {
  game.log.unshift(text);
  if (game.log.length > 120) {
    game.log.pop();
  }
}

function addTurnEffect(game, text) {
  game.turnEffects.unshift(text);
  if (game.turnEffects.length > 20) {
    game.turnEffects.pop();
  }
}

function addEffect(game, phaseOrText, maybeText) {
  const phase = maybeText ? phaseOrText : (game.currentPhase || 'General');
  const text = maybeText || phaseOrText;
  addLog(game, text);
  addTurnEffect(game, { phase, text });
}

function resetTurnEffects(game) {
  game.turnEffects = [];
}

function setTurnPhase(game, phase) {
  game.currentPhase = phase;
}

function createInitialGame(config) {
  const players = [];
  for (let i = 0; i < config.playerCount; i += 1) {
    players.push(newPlayer(`Player ${i + 1}`, i < config.humanPlayers));
  }
  assignAiModels(players, config);

  const eventsEnabled = !config.disableEvents;

  const game = {
    ruleset: config.ruleset || RULESET_CLASSIC,
    mode: config.mode,
    phase: 'setup',
    round: 1,
    currentPhase: 'Event',
    currentPlayerIndex: 0,
    startedFinalRound: false,
    finalRoundIndex: null,
    isFinished: false,
    winnerSummary: null,
    players,
    bag: { melee: 9, ranged: 5, mounted: 3 },
    market: { melee: 3, ranged: 1, mounted: 1 },
    supply: { melee: 23, ranged: 12, mounted: 8, elite: 24 },
    armoury: config.playerCount * 3,
    eventsEnabled,
    tierDecks: createTierDecks(eventsEnabled),
    rewardsDeck: createRewardsDeck(),
    offer: {
      A: [],
      B: [],
      C: [],
    },
    log: [],
    turnEffects: [],
    humanState: {
      needsInput: false,
      step: null,
      selectedContractIds: [],
      drawChoicesRemaining: 0,
    },
    undoStack: [],
    v2MarketDoneThisRound: false,
  };

  for (const tier of MAIN_TIERS) {
    const openingOffer = drawFromDeck(game, 'any', { preferredTier: tier });
    if (openingOffer) game.offer[tier].push(openingOffer);
  }

  for (const player of players) {
    for (let i = 0; i < 5; i += 1) {
      const card = drawFromDeck(game, 'contract', { preferredTier: 'A' });
      if (card) {
        player.hand.push(card);
      }
    }
  }

  addLog(game, 'Game setup complete.');
  return game;
}

function enlist(game) {
  for (const type of ['melee', 'ranged', 'mounted']) {
    // No-op, draw happens by pooled draws below.
    void type;
  }

  const recruiterBonus = hasSpecialist(getActivePlayer(game), 'The Recruiter') ? 3 : 0;
  const eventMarketDelta = getActivePlayer(game).eventInPlay?.ongoing?.marketDrawDelta || 0;
  let draws = 5 + recruiterBonus + eventMarketDelta;
  while (draws > 0) {
    const pool = [];
    if (game.bag.melee > 0) pool.push('melee');
    if (game.bag.ranged > 0) pool.push('ranged');
    if (game.bag.mounted > 0) pool.push('mounted');
    if (pool.length === 0) break;

    const type = sample(pool);
    game.bag[type] -= 1;
    game.market[type] += 1;
    draws -= 1;
  }
}

function mayTakeLoan(player) {
  return player.money <= 3 && troopTotal(player.troops) < 3 && player.debts < 2;
}

function applyEventOnPlay(game, player, eventCard) {
  player.eventInPlay = eventCard;

  const wp = eventCard.whenPlayed || {};

  if (wp.drawCard) {
    const card = drawFromDeck(game, 'contract');
    if (card) {
      player.hand.push(card);
      addEffect(game, `${player.name} drew a card from ${eventCard.name}.`);
    }
  }

  if (wp.gainCoins) {
    player.money += wp.gainCoins;
    addEffect(game, `${player.name} played ${eventCard.name} and gained ${wp.gainCoins} coins.`);
  }

  if (wp.gainEquipmentAll) {
    for (const p of game.players) {
      const gain = gainEquipment(game, p, wp.gainEquipmentAll);
      if (gain > 0) {
        addEffect(game, `${p.name} gained ${gain} equipment from ${eventCard.name}.`);
      }
    }
  }

  if (wp.addToBag) {
    for (const [type, count] of Object.entries(wp.addToBag)) {
      if (count > 0) game.bag[type] = (game.bag[type] || 0) + count;
    }
    addEffect(game, `${eventCard.name} added dice to the muster bag.`);
  }

  if (wp.addToBagFromSupply) {
    for (const [type, count] of Object.entries(wp.addToBagFromSupply)) {
      const actual = Math.min(count, game.supply[type] || 0);
      if (actual > 0) {
        game.supply[type] -= actual;
        game.bag[type] = (game.bag[type] || 0) + actual;
      }
    }
    addEffect(game, `${eventCard.name} moved dice from supply to muster bag.`);
  }

  const ongoing = eventCard.ongoing || {};
  if (ongoing.campaignCostDelta) {
    const d = ongoing.campaignCostDelta;
    addEffect(game, `${eventCard.name}: Campaign cost ${d > 0 ? `+${d}` : d} this turn.`);
  }
  if (ongoing.contractBonus) {
    const { type, coins } = ongoing.contractBonus;
    addEffect(game, `${eventCard.name}: ${type.toUpperCase()} contracts pay +${coins} coin this turn.`);
  }
  if (ongoing.marketDrawDelta) {
    const d = ongoing.marketDrawDelta;
    addEffect(game, `${eventCard.name}: Market draws ${d > 0 ? `+${d}` : d} dice this turn.`);
  }
  if (ongoing.endOfTurnDrawBonus) {
    addEffect(game, `${eventCard.name}: Draw +${ongoing.endOfTurnDrawBonus} card(s) at end of turn.`);
  }
  if (ongoing.meleeWildsDisabled) {
    addEffect(game, `${eventCard.name}: 6s on melee dice are not wild this turn.`);
  }
}

function specialistBonus(player) {
  const bonus = { melee: 0, ranged: 0, mounted: 0, wildcard: 0 };
  return bonus;
}

const battleRuntime = createBattleRuntime({
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
});

export function previewBattleOutcome(player, contract, rolls, sacrificedIndices = null) {
  return battleRuntime.previewBattleOutcome(player, contract, rolls, sacrificedIndices);
}

function canPlayContracts(player, contracts, smugglerTargetId = null) {
  const req = emptyTroops();
  for (const card of contracts) {
    if (smugglerTargetId && card.id === smugglerTargetId) {
      continue;
    }
    req.melee += card.requirements.melee;
    req.ranged += card.requirements.ranged;
    req.mounted += card.requirements.mounted;
  }

  return (
    player.troops.melee >= req.melee &&
    player.troops.ranged >= req.ranged &&
    player.troops.mounted >= req.mounted
  );
}

function chooseAiContracts(player) {
  const specialistDiscount = countSpecialist(player, 'Forager') + (2 * countSpecialist(player, 'Cook'));
  const eventCostDelta = player.eventInPlay?.ongoing?.campaignCostDelta || 0;
  const discount = specialistDiscount - eventCostDelta;

  // Pre-filter to contracts the player has at least some troops for
  const candidates = player.hand
    .filter((c) => c.kind === 'contract')
    .filter((c) =>
      (c.requirements.melee === 0 || player.troops.melee > 0) &&
      (c.requirements.ranged === 0 || player.troops.ranged > 0) &&
      (c.requirements.mounted === 0 || player.troops.mounted > 0),
    );
  candidates.sort((a, b) => (b.renown + b.coins) - (a.renown + a.coins));

  const n = candidates.length;
  let bestPicks = [];
  let bestValue = -1;

  // Search all feasible combinations up to size 3 (n is small, so O(n³) is fine)
  for (let i = 0; i < n; i++) {
    const picks1 = [candidates[i]];
    if (!canPlayContracts(player, picks1)) continue;
    if (!canAfford(player, contractCost(picks1, discount))) continue;
    const v1 = (candidates[i].renown*3) + candidates[i].coins;
    if (v1 > bestValue) { bestValue = v1; bestPicks = picks1; }

    for (let j = i + 1; j < n; j++) {
      const picks2 = [candidates[i], candidates[j]];
      if (!canPlayContracts(player, picks2)) continue;
      if (!canAfford(player, contractCost(picks2, discount))) continue;
      const v2 = v1 + candidates[j].renown + candidates[j].coins;
      if (v2 > bestValue) { bestValue = v2; bestPicks = picks2; }

      for (let k = j + 1; k < n; k++) {
        const picks3 = [candidates[i], candidates[j], candidates[k]];
        if (!canPlayContracts(player, picks3)) continue;
        if (!canAfford(player, contractCost(picks3, discount))) continue;
        const v3 = v2 + candidates[k].renown + candidates[k].coins;
        if (v3 > bestValue) { bestValue = v3; bestPicks = picks3; }
      }
    }
  }

  return bestPicks;
}

function runCampaign(game, player, selectedContracts) {
  player.campaignsRun += 1;
  player.totalContractsSelected += selectedContracts.length;

  if (selectedContracts.length === 0) {
    addLog(game, `${player.name} skipped campaign (no eligible contracts).`);
    return;
  }

  const eventCostDelta = player.eventInPlay?.ongoing?.campaignCostDelta || 0;
  const specialistDiscount = countSpecialist(player, 'Forager') + (2 * countSpecialist(player, 'Cook'));
  const discount = specialistDiscount - eventCostDelta;
  const cost = contractCost(selectedContracts, discount);

  if (!canAfford(player, cost)) {
    addLog(game, `${player.name} could not afford campaign cost (${cost}) and skipped campaign.`);
    return;
  }

  const smugglerTarget = hasSpecialist(player, 'Smuggler') ? getSmugglerTarget(selectedContracts) : null;
  const smugglerTargetId = smugglerTarget ? smugglerTarget.id : null;

  if (!canPlayContracts(player, selectedContracts, smugglerTargetId)) {
    addLog(game, `${player.name} did not meet eligibility for selected contracts.`);
    return;
  }

  if (smugglerTarget) {
    addEffect(game, `${player.name} used Smuggler to ignore requirements for ${smugglerTarget.title}.`);
  }

  player.money -= cost;

  const availableTroops = cloneTroops(player.troops);
  const completed = [];

  for (const contract of selectedContracts) {
    if (smugglerTargetId && contract.id === smugglerTargetId) {
      let rewardCoins = contract.coins;
      rewardCoins += countSpecialist(player, 'Paymaster');
      if (contract.type === 'hunt') {
        rewardCoins += countSpecialist(player, 'Trophy Maker');
      }
      const eventBonus = player.eventInPlay?.ongoing?.contractBonus;
      if (eventBonus && contract.type === eventBonus.type) rewardCoins += eventBonus.coins;

      player.money += rewardCoins;
      player.scorePile.push(contract);
      applyContractCompletionEffect(game, player, contract);
      addLog(game, `${player.name} completed ${contract.type} (${contract.region}) for ${contract.renown} renown and ${rewardCoins} coins.`);
      player.hand = player.hand.filter((card) => card.id !== contract.id);
      continue;
    }

    if (contract.type === 'guard' && hasSpecialist(player, 'Disgraced Watchman')) {
      addLog(game, `${player.name} cannot complete GUARD contracts while Disgraced Watchman is in retinue.`);
      player.hand = player.hand.filter((card) => card.id !== contract.id);
      continue;
    }

    const outcome = battleRuntime.resolveContractBattle(game, player, contract, availableTroops);

    if (outcome.success) {
      completed.push(contract);
      let rewardCoins = contract.coins;
      rewardCoins += countSpecialist(player, 'Paymaster');
      if (contract.type === 'hunt') {
        rewardCoins += countSpecialist(player, 'Trophy Maker');
      }
      const eventBonus2 = player.eventInPlay?.ongoing?.contractBonus;
      if (eventBonus2 && contract.type === eventBonus2.type) rewardCoins += eventBonus2.coins;

      player.money += rewardCoins;
      player.scorePile.push(contract);
      applyContractCompletionEffect(game, player, contract);
      addLog(game, `${player.name} completed ${contract.type} (${contract.region}) for ${contract.renown} renown and ${rewardCoins} coins.`);
    } else {
      addLog(game, `${player.name} failed ${contract.type} (${contract.region}).`);
    }

    player.hand = player.hand.filter((card) => card.id !== contract.id);
  }

  if (completed.length === 0) {
    addLog(game, `${player.name} completed no contracts this campaign.`);
  }
}

function applyRoundEndEvent(game, player) {
  const event = player.eventInPlay;
  if (!event || !event.roundEnd) return;

  switch (event.roundEnd) {
    case 'archeryContest': {
      for (const p of game.players) {
        let hits = 0;
        for (let i = 0; i < p.troops.ranged; i += 1) {
          const roll = rand(1, 6);
          if (roll === 6) hits += 2;
          else if (roll >= 4) hits += 1;
        }
        const coins = hits === 0 ? 0 : hits === 1 ? 1 : hits <= 3 ? 2 : hits <= 5 ? 3 : 6;
        if (coins > 0) {
          p.money += coins;
          addEffect(game, `${p.name} scored ${hits} hits in Archery Contest, gaining ${coins} coins.`);
        }
      }
      break;
    }
    case 'tiltRun': {
      for (const p of game.players) {
        let hits = 0;
        for (let i = 0; i < p.troops.mounted; i += 1) {
          const roll = rand(1, 6);
          if (roll === 6) hits += 2;
          else if (roll >= 4) hits += 1;
        }
        const coins = hits === 0 ? 0 : hits === 1 ? 1 : hits <= 3 ? 3 : hits <= 5 ? 5 : 10;
        if (coins > 0) {
          p.money += coins;
          addEffect(game, `${p.name} scored ${hits} hits in The Tilt Run, gaining ${coins} coins.`);
        }
      }
      break;
    }
    case 'openSeasonReward': {
      for (const p of game.players) {
        const huntCount = p.scorePile.filter((c) => c.type === 'hunt').length;
        const coins = huntCount * 2;
        if (coins > 0) {
          p.money += coins;
          addEffect(game, `${p.name} gained ${coins} coins from Open Season (${huntCount} HUNT contracts).`);
        }
      }
      break;
    }
    case 'landsBesiegedReward': {
      let best = 0;
      let winner = null;
      let tied = false;
      for (const p of game.players) {
        const count = p.scorePile.filter((c) => c.type === 'guard').length;
        if (count > best) { best = count; winner = p; tied = false; }
        else if (count === best && count > 0) { tied = true; }
      }
      if (!tied && winner) {
        const spec = drawFromDeck(game, 'specialist');
        if (spec) {
          spec.name = 'The Poet';
          winner.retinue.push(spec);
          addEffect(game, `${winner.name} gained The Poet from Lands Besieged (${best} GUARD contracts).`);
        }
      } else if (tied) {
        addEffect(game, `Lands Besieged: Tied on GUARD contracts — no one gains The Poet.`);
      }
      break;
    }
    case 'opportunismReward': {
      let best = 0;
      let winner = null;
      let tied = false;
      for (const p of game.players) {
        const count = p.scorePile.filter((c) => c.type === 'devastate').length;
        if (count > best) { best = count; winner = p; tied = false; }
        else if (count === best && count > 0) { tied = true; }
      }
      if (!tied && winner) {
        const spec = drawFromDeck(game, 'specialist');
        if (spec) {
          spec.name = 'The Opportunist';
          winner.retinue.push(spec);
          addEffect(game, `${winner.name} gained The Opportunist from Opportunism (${best} DEVASTATE contracts).`);
        }
      }
      break;
    }
    case 'cultistReward': {
      let most1s = 0;
      let winner = null;
      let tied = false;
      for (const p of game.players) {
        let ones = 0;
        for (let i = 0; i < p.troops.melee; i += 1) {
          if (rand(1, 6) === 1) ones += 1;
        }
        if (ones > most1s) { most1s = ones; winner = p; tied = false; }
        else if (ones === most1s && ones > 0) { tied = true; }
      }
      if (!tied && winner) {
        const spec = drawFromDeck(game, 'specialist');
        if (spec) {
          spec.name = 'Cultists';
          winner.retinue.push(spec);
          addEffect(game, `${winner.name} gained Cultists from Cultist Procession (${most1s} ones rolled).`);
        }
      } else if (tied) {
        addEffect(game, `Cultist Procession: Tied on 1s — no one gains Cultists.`);
      }
      break;
    }
    case 'royalAuction': {
      let richest = null;
      let mostMoney = 0;
      let tied = false;
      for (const p of game.players) {
        if (p.money > mostMoney) { mostMoney = p.money; richest = p; tied = false; }
        else if (p.money === mostMoney && p.money > 0) { tied = true; }
      }
      if (!tied && richest) {
        const bid = Math.max(1, Math.floor(richest.money / 2));
        richest.money -= bid;
        const contract = drawFromDeck(game, 'contract');
        if (contract) {
          richest.hand.push(contract);
          addEffect(game, `${richest.name} won the Royal Auction (bid ${bid} coins) and drew a contract.`);
        }
      }
      break;
    }
    default: break;
  }
}

function muster(game, player) {
  applyRoundEndEvent(game, player);

  const musterNeed = { melee: 3, ranged: 2, mounted: 1 };
  for (const type of ['melee', 'ranged', 'mounted']) {
    const add = Math.min(musterNeed[type], game.supply[type]);
    game.supply[type] -= add;
    game.bag[type] += add;
  }

  player.eventInPlay = null;
}

function drawCardToHand(game, player, source) {
  if (source.startsWith('offer:')) {
    const tier = source.split(':')[1];
    if (!MAIN_TIERS.includes(tier)) return false;
    if (game.offer[tier].length === 0) return false;

    let card = game.offer[tier].shift();
    if (!card) return false;

    if (hasSpecialist(player, 'Agent') && game.offer[tier].length > 0) {
      // Agent prefers the best contract in this tier offer, if present.
      const contractIndices = [];
      if (card.kind === 'contract') contractIndices.push(-1);
      for (let i = 0; i < game.offer[tier].length; i += 1) {
        if (game.offer[tier][i].kind === 'contract') contractIndices.push(i);
      }

      if (contractIndices.length > 0) {
        let bestIdx = contractIndices[0];
        const cardAt = (idx) => (idx === -1 ? card : game.offer[tier][idx]);
        let bestScore = cardAt(bestIdx).renown * 2 + cardAt(bestIdx).coins;
        for (let i = 1; i < contractIndices.length; i += 1) {
          const idx = contractIndices[i];
          const c = cardAt(idx);
          const score = c.renown * 2 + c.coins;
          if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        }

        if (bestIdx >= 0) {
          game.offer[tier].unshift(card);
          card = game.offer[tier].splice(bestIdx + 1, 1)[0];
        }
      }
    }

    player.hand.push(card);
    return true;
  }

  const tier = source.split(':')[1];
  if (!MAIN_TIERS.includes(tier)) return false;
  let card = null;
  if (hasSpecialist(player, 'Scout')) {
    card = drawBestContractFromTopN(game, 5);
  }

  if (!card) {
    card = drawFromDeck(game, 'any', { preferredTier: tier });
  }

  if (!card) return false;
  player.hand.push(card);
  return true;
}

function refreshOffer(game) {
  for (const tier of MAIN_TIERS) {
    game.offer[tier] = game.offer[tier].filter(Boolean);
    const offerCard = drawFromDeck(game, 'any', { preferredTier: tier });
    if (offerCard) game.offer[tier].push(offerCard);
  }
}

function autoDrawForAi(game, player) {
  const bonus = player.eventInPlay?.ongoing?.endOfTurnDrawBonus || 0;
  const draws = 2 + bonus;

  function mostContractsCompleted() {
    let maxDone = 0;
    for (const p of game.players) {
      if (p.scorePile.length > maxDone) maxDone = p.scorePile.length;
    }
    return maxDone;
  }

  function canPlayContractNow(contract) {
    return canPlayContracts(player, [contract]);
  }

  function canFeasiblyObtainTroops(contract) {
    return estimateTroopPurchasePlan(game, player, [contract]) !== null;
  }

  function drawPlayableOfferContract(tier) {
    const offer = game.offer[tier] || [];
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < offer.length; i += 1) {
      const card = offer[i];
      if (card.kind !== 'contract') continue;
      if (!canPlayContractNow(card) && !canFeasiblyObtainTroops(card)) continue;
      const score = card.renown * 2 + card.coins;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return false;
    const [picked] = offer.splice(bestIndex, 1);
    player.hand.push(picked);
    return true;
  }

  function drawFromTierDeck(tier) {
    const card = drawFromDeck(game, 'any', { preferredTier: tier });
    if (!card) return false;
    player.hand.push(card);
    return true;
  }

  for (let i = 0; i < draws; i += 1) {
    const leaderContracts = mostContractsCompleted();
    const over30 = leaderContracts > (END_GAME_CONTRACT_TARGET * 0.3);
    const over60 = leaderContracts > (END_GAME_CONTRACT_TARGET * 0.6);

    // Always prefer higher-tier offer contracts if feasible (playable now or troops obtainable).
    if (drawPlayableOfferContract('C')) continue;
    if (drawPlayableOfferContract('B')) continue;
    if (drawPlayableOfferContract('A')) continue;

    // Deck fallback: escalate through tiers as the game progresses.
    if (over60) {
      drawFromTierDeck('C');
    } else if (over30) {
      drawFromTierDeck('B');
    } else {
      drawFromTierDeck('A');
    }
  }
}

function getCampaignDiscount(player) {
  const specialistDiscount = countSpecialist(player, 'Forager') + (2 * countSpecialist(player, 'Cook'));
  const eventCostDelta = player.eventInPlay?.ongoing?.campaignCostDelta || 0;
  return specialistDiscount - eventCostDelta;
}

function estimateTroopPurchasePlan(game, player, contracts) {
  const costs = troopCostsForGame(game);
  const req = emptyTroops();
  for (const card of contracts) {
    req.melee += card.requirements.melee;
    req.ranged += card.requirements.ranged;
    req.mounted += card.requirements.mounted;
  }

  const deficits = {
    melee: Math.max(0, req.melee - player.troops.melee),
    ranged: Math.max(0, req.ranged - player.troops.ranged),
    mounted: Math.max(0, req.mounted - player.troops.mounted),
  };

  const plan = [];
  let cost = 0;

  const take = (source, type, amount, unitCost) => {
    if (amount <= 0) return 0;
    const available = source === 'market' ? game.market[type] : game.supply[type];
    const qty = Math.min(amount, available);
    if (qty > 0) {
      plan.push({ source, type, qty, unitCost });
      cost += qty * unitCost;
    }
    return qty;
  };

  for (const type of ['melee', 'ranged', 'mounted']) {
    const marketCost = costs.market[type];
    const supplyCost = costs.supply[type];
    let remaining = deficits[type];
    remaining -= take('market', type, remaining, marketCost);
    remaining -= take('supply', type, remaining, supplyCost);
    if (remaining > 0) return null;
  }

  return { plan, cost };
}

function bestAiCampaignPlan(game, player, moneyAvailable, model) {
  const contracts = player.hand.filter((c) => c.kind === 'contract');
  const n = contracts.length;
  if (n === 0) return null;

  const discount = getCampaignDiscount(player);
  const trophyMakers = countSpecialist(player, 'Trophy Maker');

  let best = null;

  function consider(bundle) {
    const troopPlan = estimateTroopPurchasePlan(game, player, bundle);
    if (!troopPlan) return;

    const campaignCost = contractCost(bundle, discount);
    const totalSpend = troopPlan.cost + campaignCost;
    if (totalSpend > moneyAvailable) return;

    const baseValue = bundle.reduce((sum, c) => (
      sum + (c.renown * model.renownWeight) + (c.coins * model.coinWeight)
    ), 0);
    const typeCount = new Set(bundle.map((c) => c.type)).size;
    const huntCount = bundle.filter((c) => c.type === 'hunt').length;
    const value = baseValue
      + (typeCount * model.setPotentialWeight)
      + (huntCount * trophyMakers * model.huntPotentialWeight)
      - (campaignCost * model.campaignCostWeight)
      - (troopPlan.cost * model.troopCostWeight);

    if (
      !best ||
      value > best.value ||
      (value === best.value && totalSpend < best.totalSpend) ||
      (value === best.value && totalSpend === best.totalSpend && bundle.length > best.bundle.length)
    ) {
      best = { bundle, troopPlan, campaignCost, totalSpend, value };
    }
  }

  for (let i = 0; i < n; i += 1) {
    consider([contracts[i]]);
    for (let j = i + 1; j < n; j += 1) {
      consider([contracts[i], contracts[j]]);
      for (let k = j + 1; k < n; k += 1) {
        consider([contracts[i], contracts[j], contracts[k]]);
      }
    }
  }

  return best;
}

function executeTroopPurchasePlan(game, player, troopPlan) {
  for (const step of troopPlan.plan) {
    for (let i = 0; i < step.qty; i += 1) {
      if (player.money < step.unitCost) return;
      const pool = step.source === 'market' ? game.market : game.supply;
      if (pool[step.type] <= 0) return;
      pool[step.type] -= 1;
      player.troops[step.type] += 1;
      player.money -= step.unitCost;
    }
  }
}

function playAiMarket(game, player) {
  const troopCosts = troopCostsForGame(game);
  const equipmentCost = economyRulesForGame(game).equipmentCost;
  const loanAmount = loanAmountForGame(game);
  const model = player.aiModel || DEFAULT_AI_MARKET_MODEL;

  const maybeNoLoanPlan = bestAiCampaignPlan(game, player, player.money, model);
  if (mayTakeLoan(player)) {
    const maybeLoanPlan = bestAiCampaignPlan(game, player, player.money + loanAmount, model);
    const noLoanScore = maybeNoLoanPlan ? maybeNoLoanPlan.value : -Infinity;
    // Make loans progressively less attractive: each additional debt raises both
    // the score penalty and the decision threshold.
    const projectedDebts = player.debts + 1;
    const debtScorePenalty = (6 * projectedDebts * projectedDebts * model.debtPenaltyWeight);
    const debtAwareThreshold = model.loanThreshold + (projectedDebts * 2.0);
    const loanScore = maybeLoanPlan ? (maybeLoanPlan.value - debtScorePenalty) : -Infinity;
    if (loanScore > 0 && loanScore > noLoanScore + debtAwareThreshold) {
      player.money += loanAmount;
      player.debts += 1;
      addLog(game, `${player.name} took a loan (${loanAmount}).`);
    }
  }

  const specialistPriority = {
    Forager: 100,
    Cook: 95,
    Paymaster: 75,
    'Trophy Maker': 75,
    Blacksmith: 60,
    Carpenter: 60,
    'Former Stablehand': 55,
    'Dockside Thug': 55,
    'Guard Recruiter': 55,
    'Veteran Archer': 55,
  };

  const specialistCards = player.hand
    .filter((card) => card.kind === 'specialist')
    .sort((a, b) => {
      const pA = specialistPriority[a.name] || 0;
      const pB = specialistPriority[b.name] || 0;
      if (pA !== pB) return pB - pA;
      return a.cost - b.cost;
    });

  for (const card of specialistCards) {
    const hireCost = specialistHireCost(game, card);
    if (player.retinue.length >= 3) break;
    if (!canAfford(player, hireCost)) continue;

    const isCostReducer = card.name === 'Forager' || card.name === 'Cook';
    const planBeforeHire = bestAiCampaignPlan(game, player, player.money, model);
    const reserve = planBeforeHire ? planBeforeHire.totalSpend : 0;
    if (!isCostReducer && player.money - hireCost < reserve) continue;

    player.money -= hireCost;
    player.retinue.push(card);
    player.hand = player.hand.filter((c) => c.id !== card.id);
    addLog(game, `${player.name} hired specialist ${card.name} for ${hireCost}.`);
    applySpecialistOnHire(game, player, card);
  }

  const bestPlan = bestAiCampaignPlan(game, player, player.money, model);
  if (bestPlan) {
    executeTroopPurchasePlan(game, player, bestPlan.troopPlan);
  }

  const reserveForCampaign = bestPlan ? contractCost(bestPlan.bundle, getCampaignDiscount(player)) : 0;

  const buyOrder = [
    { source: 'market', type: 'melee', cost: troopCosts.market.melee },
    { source: 'market', type: 'ranged', cost: troopCosts.market.ranged },
    { source: 'market', type: 'mounted', cost: troopCosts.market.mounted },
    { source: 'supply', type: 'melee', cost: troopCosts.supply.melee },
    { source: 'supply', type: 'ranged', cost: troopCosts.supply.ranged },
    { source: 'supply', type: 'mounted', cost: troopCosts.supply.mounted },
  ];

  let purchased = true;
  while (purchased) {
    purchased = false;
    for (const buy of buyOrder) {
      if (player.money - buy.cost < reserveForCampaign) continue;
      const pool = buy.source === 'market' ? game.market : game.supply;
      if (pool[buy.type] > 0) {
        pool[buy.type] -= 1;
        player.troops[buy.type] += 1;
        player.money -= buy.cost;
        purchased = true;
      }
    }
  }

  while (player.money - equipmentCost >= reserveForCampaign && game.armoury > 0 && player.equipment < 6) {
    player.money -= equipmentCost;
    gainEquipment(game, player, 1);
  }
}

function finalSetBonus(scorePile) {
  const counts = {};
  for (const contract of scorePile) {
    counts[contract.type] = (counts[contract.type] || 0) + 1;
  }

  let bonus = 0;
  while (true) {
    const types = Object.keys(counts).filter((type) => counts[type] > 0);
    if (types.length < 2) break;
    bonus += SET_SCORES[types.length] || 0;
    for (const type of types) {
      counts[type] -= 1;
    }
  }

  return bonus;
}

function computePlayerScore(player) {
  const contractRenown = player.scorePile.reduce((sum, card) => sum + card.renown, 0);
  const huntBonus = countSpecialist(player, 'Trophy Maker') * player.scorePile.filter((card) => card.type === 'hunt').length;
  const setBonus = finalSetBonus(player.scorePile);
  const debtPenalty = player.debts * 6;
  const total = contractRenown + setBonus + huntBonus - debtPenalty;
  const tierCounts = { A: 0, B: 0, C: 0, R: 0 };
  const troopCounts = {
    melee: player.troops.melee,
    ranged: player.troops.ranged,
    mounted: player.troops.mounted,
  };
  const contractsPerCampaign = player.campaignsRun > 0
    ? player.totalContractsSelected / player.campaignsRun
    : 0;
  const selectedContracts = player.totalContractsSelected;
  const contractSuccessRate = selectedContracts > 0
    ? player.scorePile.length / selectedContracts
    : 0;
  for (const card of player.scorePile) {
    const tier = (card.tier || '').toUpperCase();
    if (tierCounts[tier] !== undefined) tierCounts[tier] += 1;
  }

  return {
    contractRenown,
    huntBonus,
    setBonus,
    debtPenalty,
    total,
    contracts: player.scorePile.length,
    tierCounts,
    troopCounts,
    turns: player.turnsTaken,
    contractsPerCampaign,
    selectedContracts,
    contractSuccessRate,
    money: player.money,
    equipment: player.equipment,
  };
}

function maybeEndGame(game) {
  const active = game.players[game.currentPlayerIndex];
  if (!game.startedFinalRound && active.scorePile.length >= END_GAME_CONTRACT_TARGET) {
    game.startedFinalRound = true;
    game.finalRoundIndex = game.currentPlayerIndex;
    addLog(game, `${active.name} reached ${END_GAME_CONTRACT_TARGET} contracts. Final round has started.`);
  }
}

function nextPlayer(game) {
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  if (game.currentPlayerIndex === 0) {
    game.round += 1;
    game.v2MarketDoneThisRound = false;
    refreshOffer(game);
    addLog(game, `Round ${game.round} begins.`);
  }

  if (game.startedFinalRound && game.currentPlayerIndex === game.finalRoundIndex) {
    game.isFinished = true;
    finishGame(game);
  }
}

function finishGame(game) {
  const tieBreak = new Map();
  for (const player of game.players) {
    tieBreak.set(player.id, Math.random());
  }

  const ranking = game.players.map((player) => ({
    player,
    score: computePlayerScore(player),
  }));

  ranking.sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    if (b.score.contracts !== a.score.contracts) return b.score.contracts - a.score.contracts;
    if (b.score.money !== a.score.money) return b.score.money - a.score.money;
    return (tieBreak.get(a.player.id) || 0) - (tieBreak.get(b.player.id) || 0);
  });

  game.winnerSummary = ranking;
  addLog(game, `${ranking[0].player.name} wins with ${ranking[0].score.total} renown.`);
}

export function createGame(config) {
  const game = createInitialGame(config);
  game.phase = 'event';
  return game;
}

export function getActivePlayer(game) {
  return game.players[game.currentPlayerIndex];
}

export function runAiTurn(game) {
  if (game.isFinished) return;

  const player = getActivePlayer(game);
  player.turnsTaken += 1;
  resetTurnEffects(game);

  setTurnPhase(game, 'Income');
  applyTurnIncome(game, player);

  setTurnPhase(game, 'Event');

  if (player.eventInPlay) {
    player.eventInPlay = null;
  }

  if (game.eventsEnabled) {
    const eventFromHand = player.hand.find((card) => card.kind === 'event');
    if (eventFromHand) {
      player.hand = player.hand.filter((card) => card.id !== eventFromHand.id);
      applyEventOnPlay(game, player, eventFromHand);
    }
  }

  // V2 market phase happens once per round at the start of Player 1's turn
  if (getRuleset(game) === RULESET_V2 && game.currentPlayerIndex === 0 && !game.v2MarketDoneThisRound) {
    setTurnPhase(game, 'Market');
    playV2MarketPhase(game);
    game.v2MarketDoneThisRound = true;
  } else if (getRuleset(game) !== RULESET_V2) {
    // Classic ruleset: individual enlist and market phases
    setTurnPhase(game, 'Enlist');
    enlist(game);

    setTurnPhase(game, 'Market');
    playAiMarket(game, player);
  }

  setTurnPhase(game, 'Campaign');
  const chosen = chooseAiContracts(player);
  runCampaign(game, player, chosen);

  setTurnPhase(game, 'Muster');
  muster(game, player);
  autoDrawForAi(game, player);
  refreshOffer(game);

  // V2 upkeep phase: 3 coins per troop
  if (getRuleset(game) === RULESET_V2) {
    setTurnPhase(game, 'Upkeep');
    applyUpkeepV2(game, player);
  }

  maybeEndGame(game);
  if (!game.isFinished) {
    nextPlayer(game);
  }
}

export function runSimulation(game) {
  let turns = 0;
  while (!game.isFinished && turns < SIM_HARD_SAFETY) {
    runAiTurn(game);
    turns += 1;

    // Forced end at turn cap, but only after the current round is complete.
    if (!game.isFinished && turns >= MAX_SIM_TURNS && game.currentPlayerIndex === 0) {
      game.isFinished = true;
      finishGame(game);
      break;
    }
  }
  if (!game.isFinished) {
    game.isFinished = true;
    finishGame(game);
  }
}

/**
 * Run `count` independent simulations and return an array of result objects,
 * one per game. Each result has:
 *   {
 *     gameIndex,
 *     rounds,
 *     ranking: [{ place, name, score: { total, contractRenown, setBonus, huntBonus, debtPenalty, contracts, tierCounts, troopCounts, turns, contractsPerCampaign, selectedContracts, contractSuccessRate, money } }],
 *     turnStates: [{ turn, market, bag, supply, offer, decks }]
 *   }
 */
export function runMultipleSimulations(config, count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const g = createInitialGame({ ...config, mode: 'simulation', humanPlayers: 0, batchSimulation: true });
    g.phase = 'event';
    let turns = 0;
    const turnStates = [];
    while (!g.isFinished && turns < SIM_HARD_SAFETY) {
      runAiTurn(g);
      turns += 1;
      turnStates.push({
        turn: turns,
        market: { melee: g.market.melee, ranged: g.market.ranged, mounted: g.market.mounted },
        bag: { melee: g.bag.melee, ranged: g.bag.ranged, mounted: g.bag.mounted },
        supply: { melee: g.supply.melee, ranged: g.supply.ranged, mounted: g.supply.mounted },
        armoury: g.armoury,
        offer: {
          A: g.offer.A.length,
          B: g.offer.B.length,
          C: g.offer.C.length,
        },
        decks: {
          A: (g.tierDecks.A || []).length,
          B: (g.tierDecks.B || []).length,
          C: (g.tierDecks.C || []).length,
          R: (g.rewardsDeck || []).length,
        },
        playerEquipment: g.players.map((p) => p.equipment),
      });

      // Forced end at turn cap, but only after the current round is complete.
      if (!g.isFinished && turns >= MAX_SIM_TURNS && g.currentPlayerIndex === 0) {
        g.isFinished = true;
        finishGame(g);
        break;
      }
    }
    if (!g.isFinished) {
      g.isFinished = true;
      finishGame(g);
    }
    const ranking = (g.winnerSummary || []).map((entry, idx) => ({
      place: idx + 1,
      name: entry.player.name,
      score: entry.score,
    }));
    results.push({ gameIndex: i + 1, rounds: g.round, ranking, turnStates });
  }
  return results;
}

export function beginInteractiveTurn(game) {
  const player = getActivePlayer(game);
  resetTurnEffects(game);

  setTurnPhase(game, 'Income');
  applyTurnIncome(game, player);

  setTurnPhase(game, 'Event');

  if (!player.isHuman) {
    runAiTurn(game);
    return;
  }

  if (player.eventInPlay) {
    player.eventInPlay = null;
  }

  if (game.eventsEnabled) {
    const eventFromHand = player.hand.find((card) => card.kind === 'event');
    if (eventFromHand) {
      player.hand = player.hand.filter((card) => card.id !== eventFromHand.id);
      applyEventOnPlay(game, player, eventFromHand);
    }
  }

  // V2 market phase happens once per round at the start of Player 1's turn
  if (getRuleset(game) === RULESET_V2 && game.currentPlayerIndex === 0 && !game.v2MarketDoneThisRound) {
    setTurnPhase(game, 'Market');
    playV2MarketPhase(game);
    game.v2MarketDoneThisRound = true;
    // Skip directly to campaign for interactive mode in V2
    setTurnPhase(game, 'Campaign');
    game.undoStack = [];
    game.humanState = {
      needsInput: true,
      step: 'campaign',
      selectedContractIds: [],
      drawChoicesRemaining: 0,
    };
  } else if (getRuleset(game) !== RULESET_V2) {
    // Classic ruleset: enlist and market phases
    setTurnPhase(game, 'Enlist');
    enlist(game);
    setTurnPhase(game, 'Market');
    game.undoStack = [];
    game.humanState = {
      needsInput: true,
      step: 'market',
      selectedContractIds: [],
      drawChoicesRemaining: 0,
    };
  } else {
    // V2 but not player 1 or market already done - skip to campaign
    setTurnPhase(game, 'Campaign');
    game.undoStack = [];
    game.humanState = {
      needsInput: true,
      step: 'campaign',
      selectedContractIds: [],
      drawChoicesRemaining: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Undo support
// ---------------------------------------------------------------------------

/** Save a deep-clone snapshot of current game state onto the undo stack.
 *  The undoStack itself is excluded from the clone to avoid exponential growth.
 *  Capped at 30 entries to keep memory bounded. */
function saveUndoSnapshot(game) {
  const { undoStack, ...rest } = game;
  undoStack.push(JSON.parse(JSON.stringify(rest)));
  if (undoStack.length > 30) undoStack.shift();
}

/** Restore the most recent undo snapshot. Returns true if successful. */
export function humanUndo(game) {
  if (!game.undoStack || game.undoStack.length === 0) return false;
  const snapshot = game.undoStack.pop();
  const stack = game.undoStack; // preserve the live stack reference
  // Wipe all current properties except undoStack
  for (const key of Object.keys(game)) {
    if (key !== 'undoStack') delete game[key];
  }
  Object.assign(game, snapshot);
  game.undoStack = stack; // put the (now shorter) live stack back
  return true;
}

// ---------------------------------------------------------------------------

export function humanTakeLoan(game) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  const loanAmount = loanAmountForGame(game);
  if (!mayTakeLoan(player)) { game.undoStack.pop(); return false; }
  player.money += loanAmount;
  player.debts += 1;
  addLog(game, `${player.name} took a loan (${loanAmount}).`);
  return true;
}

export function humanBuyTroop(game, from, type) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  const troopCosts = troopCostsForGame(game);
  const marketCosts = troopCosts.market;
  const supplyCosts = troopCosts.supply;
  const cost = from === 'market' ? marketCosts[type] : supplyCosts[type];

  if (!canAfford(player, cost)) { game.undoStack.pop(); return false; }

  if (from === 'market') {
    if (game.market[type] <= 0) { game.undoStack.pop(); return false; }
    game.market[type] -= 1;
  } else {
    if (game.supply[type] <= 0) { game.undoStack.pop(); return false; }
    game.supply[type] -= 1;
  }

  player.money -= cost;
  player.troops[type] += 1;
  return true;
}

export function humanBuyEquipment(game) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  const equipmentCost = economyRulesForGame(game).equipmentCost;
  if (!canAfford(player, equipmentCost) || game.armoury <= 0) { game.undoStack.pop(); return false; }
  player.money -= equipmentCost;
  gainEquipment(game, player, 1);
  return true;
}

export function humanHireSpecialist(game, cardId) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  if (player.retinue.length >= 3) { game.undoStack.pop(); return false; }

  const card = player.hand.find((c) => c.id === cardId && c.kind === 'specialist');
  if (!card) { game.undoStack.pop(); return false; }
  const hireCost = specialistHireCost(game, card);
  if (!canAfford(player, hireCost)) { game.undoStack.pop(); return false; }

  player.money -= hireCost;
  player.retinue.push(card);
  player.hand = player.hand.filter((c) => c.id !== card.id);
  applySpecialistOnHire(game, player, card);

  return true;
}

export function humanDischargeSpecialist(game, specialistId) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  const exists = player.retinue.some((s) => s.id === specialistId);
  if (!exists) { game.undoStack.pop(); return false; }
  player.retinue = player.retinue.filter((s) => s.id !== specialistId);
  return true;
}

export function humanProceedToCampaign(game) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Campaign');
  game.humanState.step = 'campaign';
  game.humanState.selectedContractIds = [];
}

export function humanToggleContractSelection(game, contractId) {
  saveUndoSnapshot(game);
  const player = getActivePlayer(game);
  const card = player.hand.find((c) => c.id === contractId && c.kind === 'contract');
  if (!card) { game.undoStack.pop(); return; }

  const ids = game.humanState.selectedContractIds;
  if (ids.includes(contractId)) {
    game.humanState.selectedContractIds = ids.filter((id) => id !== contractId);
    return;
  }

  if (ids.length >= 3) return;
  game.humanState.selectedContractIds = [...ids, contractId];
}

function beginMuster(game, player) {
  setTurnPhase(game, 'Muster');
  muster(game, player);
  game.humanState.step = 'draw';
  game.humanState.drawChoicesRemaining = 2;
}

export function humanRunCampaign(game) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Campaign');
  const player = getActivePlayer(game);
  const ids = game.humanState.selectedContractIds;
  const cards = player.hand.filter((card) => ids.includes(card.id) && card.kind === 'contract');

  if (cards.length === 0) {
    addLog(game, `${player.name} skipped campaign.`);
    beginMuster(game, player);
    return;
  }

  const eventCostDelta = player.eventInPlay?.ongoing?.campaignCostDelta || 0;
  const specialistDiscount = countSpecialist(player, 'Forager') + (2 * countSpecialist(player, 'Cook'));
  const discount = specialistDiscount - eventCostDelta;
  const cost = contractCost(cards, discount);

  if (!canAfford(player, cost)) {
    addLog(game, `${player.name} could not afford campaign cost (${cost}).`);
    beginMuster(game, player);
    return;
  }

  const smugglerTarget = hasSpecialist(player, 'Smuggler') ? getSmugglerTarget(cards) : null;
  const smugglerTargetId = smugglerTarget ? smugglerTarget.id : null;

  if (!canPlayContracts(player, cards, smugglerTargetId)) {
    addLog(game, `${player.name} did not meet eligibility for selected contracts.`);
    beginMuster(game, player);
    return;
  }

  player.money -= cost;
  const availableTroops = cloneTroops(player.troops);
  const battleQueue = [];

  for (const contract of cards) {
    if (smugglerTargetId && contract.id === smugglerTargetId) {
      let rewardCoins = contract.coins + countSpecialist(player, 'Paymaster');
      if (contract.type === 'hunt') rewardCoins += countSpecialist(player, 'Trophy Maker');
      const eb = player.eventInPlay?.ongoing?.contractBonus;
      if (eb && contract.type === eb.type) rewardCoins += eb.coins;
      player.money += rewardCoins;
      player.scorePile.push(contract);
      applyContractCompletionEffect(game, player, contract);
      addLog(game, `${player.name} smuggled ${contract.title} (${contract.renown} renown, ${rewardCoins} coins).`);
      player.hand = player.hand.filter((c) => c.id !== contract.id);
      continue;
    }
    if (contract.type === 'guard' && hasSpecialist(player, 'Disgraced Watchman')) {
      addLog(game, `${player.name} cannot complete GUARD contracts (Disgraced Watchman).`);
      player.hand = player.hand.filter((c) => c.id !== contract.id);
      continue;
    }
    battleQueue.push(contract);
  }

  if (battleQueue.length === 0) {
    beginMuster(game, player);
    return;
  }

  game.humanState.pendingBattle = {
    contractQueue: battleQueue.slice(1),
    currentContract: battleQueue[0],
    availableTroops,
    rolls: battleRuntime.rollContractDice(availableTroops),
    sacrificed: { melee: [], ranged: [], mounted: [] },
  };
  game.humanState.step = 'battle';
}

export function humanRerollDie(game, type, index) {
  const player = getActivePlayer(game);
  if (game.humanState.step !== 'battle') return false;
  if (player.equipment <= 0 || game.armoury <= 0) return false;
  const pb = game.humanState.pendingBattle;
  const rolls = pb.rolls;
  if (!rolls[type] || index >= rolls[type].length) return false;
  player.equipment -= 1;
  game.armoury += 1;
  rolls[type][index] = rand(1, 6);
  // Clear sacrifice on the rerolled die
  pb.sacrificed[type] = pb.sacrificed[type].filter((i) => i !== index);
  addEffect(game, `${player.name} spent 1 equipment to reroll a ${type} die → ${rolls[type][index]}.`);
  return true;
}

export function humanToggleSacrifice(game, type, index) {
  const player = getActivePlayer(game);
  if (game.humanState.step !== 'battle') return false;
  const pb = game.humanState.pendingBattle;
  const roll = pb.rolls[type]?.[index];
  if (roll === undefined) return false;
  const isEligible = isSacrificeEligibleRoll(player, roll);
  if (!isEligible) return false;
  const sac = pb.sacrificed[type];
  const pos = sac.indexOf(index);
  if (pos === -1) sac.push(index);
  else sac.splice(pos, 1);
  return true;
}

export function humanConfirmBattle(game) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Campaign');
  const player = getActivePlayer(game);
  const pb = game.humanState.pendingBattle;
  const { currentContract, rolls, availableTroops } = pb;

  const outcome = battleRuntime.finalizeContractBattle(game, player, currentContract, rolls, availableTroops, pb.sacrificed);

  if (outcome.success) {
    let rewardCoins = currentContract.coins + countSpecialist(player, 'Paymaster');
    if (currentContract.type === 'hunt') rewardCoins += countSpecialist(player, 'Trophy Maker');
    const eb = player.eventInPlay?.ongoing?.contractBonus;
    if (eb && currentContract.type === eb.type) rewardCoins += eb.coins;
    player.money += rewardCoins;
    player.scorePile.push(currentContract);
    applyContractCompletionEffect(game, player, currentContract);
    addLog(game, `${player.name} completed ${currentContract.type} (${currentContract.region}) for ${currentContract.renown} renown and ${rewardCoins} coins.`);
  } else {
    addLog(game, `${player.name} failed ${currentContract.type} (${currentContract.region}).`);
  }

  player.hand = player.hand.filter((c) => c.id !== currentContract.id);

  const next = pb.contractQueue.shift();
  if (next) {
    pb.currentContract = next;
    pb.rolls = battleRuntime.rollContractDice(pb.availableTroops);
    pb.sacrificed = { melee: [], ranged: [], mounted: [] };
  } else {
    game.humanState.pendingBattle = null;
    beginMuster(game, player);
  }
}

export function humanDrawCard(game, source) {
  saveUndoSnapshot(game);
  setTurnPhase(game, 'Muster');
  const player = getActivePlayer(game);
  if (game.humanState.step !== 'draw') { game.undoStack.pop(); return false; }

  const ok = drawCardToHand(game, player, source);
  if (!ok) { game.undoStack.pop(); return false; }

  game.humanState.drawChoicesRemaining -= 1;
  if (game.humanState.drawChoicesRemaining <= 0) {
    // V2 upkeep phase: 3 coins per troop
    if (getRuleset(game) === RULESET_V2) {
      setTurnPhase(game, 'Upkeep');
      applyUpkeepV2(game, player);
    }

    refreshOffer(game);
    maybeEndGame(game);
    game.humanState = {
      needsInput: false,
      step: null,
      selectedContractIds: [],
      drawChoicesRemaining: 0,
    };

    if (!game.isFinished) {
      nextPlayer(game);
    }
  }

  return true;
}

export function autoPlayUntilHumanOrEnd(game) {
  while (!game.isFinished) {
    const player = getActivePlayer(game);
    if (game.mode === 'interactive' && player.isHuman) {
      beginInteractiveTurn(game);
      break;
    }
    runAiTurn(game);
  }
}

export function scoreTable(game) {
  return game.players.map((player) => ({
    player,
    score: computePlayerScore(player),
  }));
}
