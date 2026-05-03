import { CONTRACT_CARDS } from './contractsData';
import { SPECIALIST_CARDS } from './specialistsData';

const SET_SCORES = {
  1: 0,
  2: 1,
  3: 3,
  4: 6,
  5: 10,
  6: 15,
};

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

function getSmugglerTarget(selectedContracts) {
  let target = null;
  let bestDifficulty = -1;
  for (const card of selectedContracts) {
    const difficulty = card.requirements.melee + card.requirements.ranged + card.requirements.mounted;
    if (difficulty > bestDifficulty) {
      bestDifficulty = difficulty;
      target = card;
    }
  }
  return target;
}

function createTierDecks() {
  const tierDecks = { A: [], B: [], C: [] };

  for (const template of CONTRACT_CARDS) {
    if (!MAIN_TIERS.includes(template.tier)) continue;
    for (let i = 0; i < template.copies; i += 1) {
      tierDecks[template.tier].push({
        id: uid('contract'),
        kind: 'contract',
        title: template.title,
        type: template.type,
        region: template.region,
        requirements: cloneTroops(template.requirements),
        renown: template.renown,
        coins: template.coins,
        tier: template.tier,
        cardNumber: template.cardNumber,
        completionEffect: template.completionEffect || '',
      });
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
    roundEnd: 'archeryContest',
  },
  {
    name: 'Disbanded Troops', tier: 'A', copies: 1,
    whenPlayed: { drawCard: true, gainEquipmentAll: 1 },
    ongoing: { recruitCostReduction: 1 },
    roundEnd: null,
  },
  {
    name: 'Drought', tier: 'A', copies: 1,
    whenPlayed: { drawCard: true },
    ongoing: { campaignCostDelta: 2 },
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
      cards.push({
        id: uid('reward-contract'),
        kind: 'contract',
        title: template.title,
        type: template.type,
        region: template.region,
        requirements: cloneTroops(template.requirements),
        renown: template.renown,
        coins: template.coins,
        tier: template.tier,
        cardNumber: template.cardNumber,
        completionEffect: template.completionEffect || '',
      });
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

  const game = {
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
    armoury: config.playerCount * 4,
    tierDecks: createTierDecks(),
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

function rollContractDice(availableTroops) {
  const rolls = { melee: [], ranged: [], mounted: [] };
  for (const type of ['melee', 'ranged', 'mounted']) {
    for (let i = 0; i < availableTroops[type]; i += 1) {
      rolls[type].push(rand(1, 6));
    }
  }
  return rolls;
}

function classifyRolls(rolls, player) {
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

function isSacrificeEligibleRoll(player, roll) {
  void player;
  return roll === 3 || (roll >= 4 && roll <= 6);
}

function getAutoSacrificeCounts(player, typeRolls) {
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

export function previewBattleOutcome(player, contract, rolls, sacrificedIndices = null) {
  const { successes, wildcard: wc, wounded, dead } = classifyRolls(rolls, player);
  const rem = cloneTroops(contract.requirements);
  let remainingWild = wc;
  const exSuc = cloneTroops(successes);

  if (sacrificedIndices !== null) {
    // Apply explicit player sacrifices
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
    // Auto-sacrifice potential (AI / simple preview without explicit choices)
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

function finalizeContractBattle(game, player, contract, rolls, availableTroops, humanSacrificed = null) {
  const req = cloneTroops(contract.requirements);
  const { successes, wildcard: initWild, wounded, dead } = classifyRolls(rolls, player);
  let wildcard = initWild;

  const bonus = specialistBonus(player);
  successes.melee += bonus.melee;
  successes.ranged += bonus.ranged;
  successes.mounted += bonus.mounted;
  wildcard += bonus.wildcard;

  // Apply explicit human sacrifices before filling requirements
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
      if (dead[type] > 0) { dead[type] -= 1; wounded[type] += 1; break; }
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

function resolveContractBattle(game, player, contract, availableTroops) {
  const rolls = rollContractDice(availableTroops);

  // AI: spend equipment to reroll dead dice (1-2) when losing, one at a time.
  // Stop as soon as the battle is projected to be won or equipment runs out.
  if (player.equipment > 0) {
    const types = ['melee', 'ranged', 'mounted'];
    let spent = 0;
    while (player.equipment > 0) {
      const preview = previewBattleOutcome(player, contract, rolls);
      if (preview.willSucceed) break;
      // Reroll the lowest dead die (roll 1 before 2) to maximise value
      let rerolled = false;
      for (const face of [1, 2]) {
        for (const type of types) {
          const idx = rolls[type].indexOf(face);
          if (idx !== -1) {
            rolls[type][idx] = Math.ceil(Math.random() * 6);
            player.equipment -= 1;
            spent += 1;
            rerolled = true;
            break;
          }
        }
        if (rerolled) break;
      }
      if (!rerolled) break; // No dead dice remain to reroll
    }
    if (spent > 0) {
      addEffect(game, `${player.name} used ${spent} equipment to reroll dice.`);
    }
  }

  return finalizeContractBattle(game, player, contract, rolls, availableTroops);
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
    const v1 = candidates[i].renown + candidates[i].coins;
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

    const outcome = resolveContractBattle(game, player, contract, availableTroops);

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

  // Always draw at least one card from Tier A if available.
  const tierAOffer = game.offer.A.length > 0 ? 'offer:A' : 'deck:A';
  drawCardToHand(game, player, tierAOffer);

  for (let i = 1; i < draws; i += 1) {
    const sources = ['offer:A', 'offer:B', 'offer:C', 'deck:A', 'deck:B', 'deck:C'];
    drawCardToHand(game, player, sample(sources));
  }
}

function playAiMarket(game, player) {
  if (mayTakeLoan(player) && Math.random() > 0.45) {
    player.money += 10;
    player.debts += 1;
    addLog(game, `${player.name} took a loan.`);
  }

  const specialistCards = player.hand.filter((card) => card.kind === 'specialist');
  for (const card of specialistCards) {
    if (player.retinue.length >= 3) break;
    if (canAfford(player, card.cost)) {
      player.money -= card.cost;
      player.retinue.push(card);
      player.hand = player.hand.filter((c) => c.id !== card.id);
      addLog(game, `${player.name} hired specialist ${card.name}.`);
      applySpecialistOnHire(game, player, card);
    }
  }

  const buyOrder = [
    { source: 'market', type: 'melee', cost: 2 },
    { source: 'market', type: 'ranged', cost: 3 },
    { source: 'market', type: 'mounted', cost: 4 },
    { source: 'supply', type: 'melee', cost: 4 },
    { source: 'supply', type: 'ranged', cost: 6 },
    { source: 'supply', type: 'mounted', cost: 8 },
  ];

  for (const buy of buyOrder) {
    if (player.money < buy.cost) continue;
    if (buy.source === 'market' && game.market[buy.type] > 0) {
      game.market[buy.type] -= 1;
      player.troops[buy.type] += 1;
      player.money -= buy.cost;
    }
    if (buy.source === 'supply' && game.supply[buy.type] > 0 && player.money >= buy.cost) {
      game.supply[buy.type] -= 1;
      player.troops[buy.type] += 1;
      player.money -= buy.cost;
    }
  }

  while (player.money >= 1 && game.armoury > 0 && player.equipment < 6) {
    player.money -= 1;
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
    money: player.money,
  };
}

function maybeEndGame(game) {
  const active = game.players[game.currentPlayerIndex];
  if (!game.startedFinalRound && active.scorePile.length >= 10) {
    game.startedFinalRound = true;
    game.finalRoundIndex = game.currentPlayerIndex;
    addLog(game, `${active.name} reached 10 contracts. Final round has started.`);
  }
}

function nextPlayer(game) {
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  if (game.currentPlayerIndex === 0) {
    game.round += 1;
    refreshOffer(game);
    addLog(game, `Round ${game.round} begins.`);
  }

  if (game.startedFinalRound && game.currentPlayerIndex === game.finalRoundIndex) {
    game.isFinished = true;
    finishGame(game);
  }
}

function finishGame(game) {
  const ranking = game.players.map((player) => ({
    player,
    score: computePlayerScore(player),
  }));

  ranking.sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    if (b.score.contracts !== a.score.contracts) return b.score.contracts - a.score.contracts;
    if (b.score.money !== a.score.money) return b.score.money - a.score.money;
    return 0;
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
  resetTurnEffects(game);
  setTurnPhase(game, 'Event');

  if (player.eventInPlay) {
    player.eventInPlay = null;
  }

  const eventFromHand = player.hand.find((card) => card.kind === 'event');
  if (eventFromHand) {
    player.hand = player.hand.filter((card) => card.id !== eventFromHand.id);
    applyEventOnPlay(game, player, eventFromHand);
  }

  setTurnPhase(game, 'Enlist');
  enlist(game);

  setTurnPhase(game, 'Market');
  playAiMarket(game, player);

  setTurnPhase(game, 'Campaign');
  const chosen = chooseAiContracts(player);
  runCampaign(game, player, chosen);

  setTurnPhase(game, 'Muster');
  muster(game, player);
  autoDrawForAi(game, player);
  refreshOffer(game);

  maybeEndGame(game);
  if (!game.isFinished) {
    nextPlayer(game);
  }
}

export function runSimulation(game) {
  let safety = 0;
  while (!game.isFinished && safety < 2000) {
    runAiTurn(game);
    safety += 1;
  }
  if (!game.isFinished) {
    game.isFinished = true;
    finishGame(game);
  }
}

/**
 * Run `count` independent simulations and return an array of result objects,
 * one per game. Each result has:
 *   { gameIndex, rounds, ranking: [{ place, name, score: { total, contractRenown, setBonus, huntBonus, debtPenalty, contracts, tierCounts, money } }] }
 */
export function runMultipleSimulations(config, count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const g = createInitialGame({ ...config, mode: 'simulation', humanPlayers: 0 });
    g.phase = 'event';
    let safety = 0;
    while (!g.isFinished && safety < 2000) {
      runAiTurn(g);
      safety += 1;
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
    results.push({ gameIndex: i + 1, rounds: g.round, ranking });
  }
  return results;
}

export function beginInteractiveTurn(game) {
  const player = getActivePlayer(game);
  resetTurnEffects(game);
  setTurnPhase(game, 'Event');

  if (!player.isHuman) {
    runAiTurn(game);
    return;
  }

  if (player.eventInPlay) {
    player.eventInPlay = null;
  }

  const eventFromHand = player.hand.find((card) => card.kind === 'event');
  if (eventFromHand) {
    player.hand = player.hand.filter((card) => card.id !== eventFromHand.id);
    applyEventOnPlay(game, player, eventFromHand);
  }

  setTurnPhase(game, 'Enlist');
  enlist(game);
  setTurnPhase(game, 'Market');
  game.humanState = {
    needsInput: true,
    step: 'market',
    selectedContractIds: [],
    drawChoicesRemaining: 0,
  };
}

export function humanTakeLoan(game) {
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  if (!mayTakeLoan(player)) return false;
  player.money += 10;
  player.debts += 1;
  addLog(game, `${player.name} took a loan.`);
  return true;
}

export function humanBuyTroop(game, from, type) {
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  const marketCosts = { melee: 2, ranged: 3, mounted: 4 };
  const supplyCosts = { melee: 4, ranged: 6, mounted: 8 };
  const cost = from === 'market' ? marketCosts[type] : supplyCosts[type];

  if (!canAfford(player, cost)) return false;

  if (from === 'market') {
    if (game.market[type] <= 0) return false;
    game.market[type] -= 1;
  } else {
    if (game.supply[type] <= 0) return false;
    game.supply[type] -= 1;
  }

  player.money -= cost;
  player.troops[type] += 1;
  return true;
}

export function humanBuyEquipment(game) {
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  if (!canAfford(player, 1) || game.armoury <= 0) return false;
  player.money -= 1;
  gainEquipment(game, player, 1);
  return true;
}

export function humanHireSpecialist(game, cardId) {
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  if (player.retinue.length >= 3) return false;

  const card = player.hand.find((c) => c.id === cardId && c.kind === 'specialist');
  if (!card) return false;
  if (!canAfford(player, card.cost)) return false;

  player.money -= card.cost;
  player.retinue.push(card);
  player.hand = player.hand.filter((c) => c.id !== card.id);
  applySpecialistOnHire(game, player, card);

  return true;
}

export function humanDischargeSpecialist(game, specialistId) {
  setTurnPhase(game, 'Market');
  const player = getActivePlayer(game);
  const exists = player.retinue.some((s) => s.id === specialistId);
  if (!exists) return false;
  player.retinue = player.retinue.filter((s) => s.id !== specialistId);
  return true;
}

export function humanProceedToCampaign(game) {
  setTurnPhase(game, 'Campaign');
  game.humanState.step = 'campaign';
  game.humanState.selectedContractIds = [];
}

export function humanToggleContractSelection(game, contractId) {
  const player = getActivePlayer(game);
  const card = player.hand.find((c) => c.id === contractId && c.kind === 'contract');
  if (!card) return;

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
    rolls: rollContractDice(availableTroops),
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
  setTurnPhase(game, 'Campaign');
  const player = getActivePlayer(game);
  const pb = game.humanState.pendingBattle;
  const { currentContract, rolls, availableTroops } = pb;

  const outcome = finalizeContractBattle(game, player, currentContract, rolls, availableTroops, pb.sacrificed);

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
    pb.rolls = rollContractDice(pb.availableTroops);
    pb.sacrificed = { melee: [], ranged: [], mounted: [] };
  } else {
    game.humanState.pendingBattle = null;
    beginMuster(game, player);
  }
}

export function humanDrawCard(game, source) {
  setTurnPhase(game, 'Muster');
  const player = getActivePlayer(game);
  if (game.humanState.step !== 'draw') return false;

  const ok = drawCardToHand(game, player, source);
  if (!ok) return false;

  game.humanState.drawChoicesRemaining -= 1;
  if (game.humanState.drawChoicesRemaining <= 0) {
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
