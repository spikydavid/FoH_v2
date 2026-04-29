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

function drawContractFromTopN(game, count, chooser) {
  const take = Math.min(count, game.contractDeck.length);
  if (take <= 0) return null;

  const pool = game.contractDeck.splice(0, take);
  const pickedIndex = Math.max(0, Math.min(pool.length - 1, chooser(pool)));
  const picked = pool.splice(pickedIndex, 1)[0];

  game.contractDeck = shuffle([...pool, ...game.contractDeck]);
  return picked;
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
  const indices = [];
  for (let i = 0; i < game.contractDeck.length; i += 1) {
    if (game.contractDeck[i].type === type) {
      indices.push(i);
    }
  }

  if (indices.length === 0) return null;

  let bestIndex = indices[0];
  let bestScore = game.contractDeck[bestIndex].renown * 2 + game.contractDeck[bestIndex].coins;
  for (let i = 1; i < indices.length; i += 1) {
    const index = indices[i];
    const score = game.contractDeck[index].renown * 2 + game.contractDeck[index].coins;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return game.contractDeck.splice(bestIndex, 1)[0];
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

function createContractDeck() {
  const cards = [];
  for (const template of CONTRACT_CARDS) {
    for (let i = 0; i < template.copies; i += 1) {
      cards.push({
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
  return shuffle(cards);
}

function createSpecialistDeck() {
  const cards = [];
  for (const template of SPECIALIST_CARDS) {
    for (let i = 0; i < template.copies; i += 1) {
      cards.push({
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
  return shuffle(cards);
}

function drawContractFromGame(game, preferredTier = null) {
  if (game.contractDeck.length === 0) {
    return null;
  }

  if (!preferredTier) {
    return game.contractDeck.shift();
  }

  const index = game.contractDeck.findIndex((card) => card.tier === preferredTier);
  if (index >= 0) {
    return game.contractDeck.splice(index, 1)[0];
  }

  return game.contractDeck.shift();
}

function deckSpecialist() {
  return null;
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
  if (kind === 'contract') return drawContractFromGame(game, options.preferredTier || null);
  if (kind === 'specialist') return game.specialistDeck.shift() || null;
  if (kind === 'event') return game.eventDeck.shift() || null;
  return null;
}

function contractCost(contracts, discount = 0) {
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
    contractDeck: createContractDeck(),
    specialistDeck: createSpecialistDeck(),
    eventDeck: createEventDeck(),
    offer: {
      contract: [],
      specialist: [],
      event: [],
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

  const openingContract = drawFromDeck(game, 'contract');
  if (openingContract) game.offer.contract.push(openingContract);
  const openingSpecialist = drawFromDeck(game, 'specialist');
  if (openingSpecialist) game.offer.specialist.push(openingSpecialist);
  game.offer.event.push(drawFromDeck(game, 'event'));

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

function resolveContractBattle(game, player, contract, availableTroops) {
  const req = cloneTroops(contract.requirements);
  const rolls = { melee: [], ranged: [], mounted: [] };
  const successes = emptyTroops();
  let wildcard = 0;
  const wounded = emptyTroops();
  const dead = emptyTroops();
  let drillSergeantFlips = hasSpecialist(player, 'Drill Sergeant') ? 2 : 0;
  const standardBearer = hasSpecialist(player, 'Standard Bearer');

  for (const type of ['melee', 'ranged', 'mounted']) {
    for (let i = 0; i < availableTroops[type]; i += 1) {
      const roll = rand(1, 6);
      rolls[type].push(roll);
      if (roll <= 2) {
        dead[type] += 1;
      } else if (roll === 3) {
        wounded[type] += 1;
        if (standardBearer) {
          successes[type] += 1;
        }
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

  const bonus = specialistBonus(player);
  successes.melee += bonus.melee;
  successes.ranged += bonus.ranged;
  successes.mounted += bonus.mounted;
  wildcard += bonus.wildcard;

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

  // Kill non-contributing units to push across the line.
  let sacrificed = 0;
  for (const type of ['melee', 'ranged', 'mounted']) {
    if (req[type] === 0) continue;
    const killable = successes[type] + wounded[type];
    const use = Math.min(req[type], killable);
    req[type] -= use;
    dead[type] += use;
    sacrificed += use;
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
    if (gain > 0) {
      addEffect(game, `${player.name}'s Grave Robber gained 1 coin and ${gain} equipment.`);
    } else {
      addEffect(game, `${player.name}'s Grave Robber gained 1 coin.`);
    }
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
    if (draws > 0) {
      addEffect(game, `${player.name}'s Chaplain drew ${draws} card(s) from sacrifice.`);
    }
  }

  const success = req.melee + req.ranged + req.mounted === 0;

  // Apply losses and wound lockout for subsequent contracts in the same campaign.
  for (const type of ['melee', 'ranged', 'mounted']) {
    player.troops[type] -= dead[type];
    game.supply[type] += dead[type];
    availableTroops[type] = Math.max(0, availableTroops[type] - dead[type] - wounded[type]);
  }

  return {
    success,
    dead,
    wounded,
    rolls,
    assigned,
  };
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
  const contracts = player.hand.filter((card) => card.kind === 'contract');
  contracts.sort((a, b) => (b.renown + b.coins) - (a.renown + a.coins));

  for (let size = Math.min(3, contracts.length); size >= 1; size -= 1) {
    const picks = contracts.slice(0, size);
    if (canPlayContracts(player, picks)) {
      return picks;
    }
  }

  return [];
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
    const kind = source.split(':')[1];
    if (game.offer[kind].length === 0) return false;

    let card = game.offer[kind].shift();
    if (kind === 'contract' && hasSpecialist(player, 'Agent') && game.offer[kind].length > 0) {
      let bestIndex = 0;
      let bestScore = card.renown * 2 + card.coins;
      for (let i = 0; i < game.offer[kind].length; i += 1) {
        const score = game.offer[kind][i].renown * 2 + game.offer[kind][i].coins;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i + 1;
        }
      }

      if (bestIndex > 0) {
        game.offer[kind].unshift(card);
        card = game.offer[kind].splice(bestIndex, 1)[0];
      }
    }

    player.hand.push(card);
    return true;
  }

  const kind = source.split(':')[1];
  let card = null;
  if (kind === 'contract' && hasSpecialist(player, 'Scout')) {
    card = drawBestContractFromTopN(game, 5);
  }

  if (!card) {
    card = drawFromDeck(game, kind);
  }

  if (!card) return false;
  player.hand.push(card);
  return true;
}

function refreshOffer(game) {
  const contract = drawFromDeck(game, 'contract');
  if (contract) game.offer.contract.push(contract);
  const specialist = drawFromDeck(game, 'specialist');
  if (specialist) game.offer.specialist.push(specialist);
  game.offer.event.push(drawFromDeck(game, 'event'));
}

function autoDrawForAi(game, player) {
  const bonus = player.eventInPlay?.ongoing?.endOfTurnDrawBonus || 0;
  const draws = 2 + bonus;
  for (let i = 0; i < draws; i += 1) {
    const sources = ['offer:contract', 'offer:specialist', 'offer:event', 'deck:contract'];
    const source = sample(sources);
    drawCardToHand(game, player, source);
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

  return {
    contractRenown,
    huntBonus,
    setBonus,
    debtPenalty,
    total,
    contracts: player.scorePile.length,
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
  while (!game.isFinished) {
    runAiTurn(game);
  }
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

export function humanRunCampaign(game) {
  setTurnPhase(game, 'Campaign');
  const player = getActivePlayer(game);
  const ids = game.humanState.selectedContractIds;
  const cards = player.hand.filter((card) => ids.includes(card.id) && card.kind === 'contract');

  if (cards.length === 0) {
    addLog(game, `${player.name} skipped campaign.`);
  } else {
    runCampaign(game, player, cards);
  }

  setTurnPhase(game, 'Muster');
  muster(game, player);
  game.humanState.step = 'draw';
  game.humanState.drawChoicesRemaining = 2;
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
