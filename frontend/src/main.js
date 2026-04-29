import './style.css';
import {
  autoPlayUntilHumanOrEnd,
  createGame,
  getActivePlayer,
  humanBuyEquipment,
  humanBuyTroop,
  humanDischargeSpecialist,
  humanDrawCard,
  humanHireSpecialist,
  humanProceedToCampaign,
  humanRunCampaign,
  humanTakeLoan,
  humanToggleContractSelection,
  runSimulation,
  scoreTable,
} from './gameEngine';
import { CONTRACT_DATA_SYNC } from './contractsData';
import { SPECIALIST_DATA_SYNC } from './specialistsData';

const app = document.querySelector('#app');
let game = null;

function contractText(card) {
  const reward = card.tier === 'R' && card.completionEffect ? ` | Reward: ${card.completionEffect.replace(/\*\*/g, '')}` : '';
  return `${card.title} (#${card.cardNumber}, ${card.tier}) ${card.type.toUpperCase()} [${card.region}] req M${card.requirements.melee}/R${card.requirements.ranged}/Mo${card.requirements.mounted} -> ${card.renown} renown, ${card.coins} coins${reward}`;
}

function renderTurnEffects() {
  if (!game.turnEffects || game.turnEffects.length === 0) {
    return '<div>No triggered effects yet this turn.</div>';
  }

  const phases = ['Event', 'Enlist', 'Market', 'Campaign', 'Muster', 'General'];
  const grouped = {};
  for (const effect of game.turnEffects) {
    const phase = effect.phase || 'General';
    if (!grouped[phase]) grouped[phase] = [];
    grouped[phase].push(effect.text);
  }

  return phases
    .filter((phase) => grouped[phase] && grouped[phase].length > 0)
    .map(
      (phase) => `
        <div class="effects-phase">
          <h4>${phase}</h4>
          ${grouped[phase].map((line) => `<div>${line}</div>`).join('')}
        </div>
      `,
    )
    .join('');
}

function renderStartScreen() {
  app.innerHTML = `
    <main class="layout">
      <section class="panel hero">
        <h1>Field of Honour Simulator</h1>
        <p>Playable implementation based on the provided rule document with two modes.</p>
        <p class="meta">Contracts synced from spreadsheet ${CONTRACT_DATA_SYNC.spreadsheetId} on ${CONTRACT_DATA_SYNC.syncedAt}.</p>
        <p class="meta">Specialists synced from spreadsheet ${SPECIALIST_DATA_SYNC.spreadsheetId} on ${SPECIALIST_DATA_SYNC.syncedAt}.</p>
        <div class="mode-buttons">
          <button id="start-sim">Simulation Mode (AI only)</button>
          <button id="start-int">Interactive Mode (humans + AI)</button>
        </div>
        <form id="config-form">
          <label>Players (2-4)
            <input id="player-count" type="number" min="2" max="4" value="4" />
          </label>
          <label>Human players (0-4)
            <input id="human-count" type="number" min="0" max="4" value="1" />
          </label>
        </form>
      </section>
    </main>
  `;

  const playersInput = document.querySelector('#player-count');
  const humansInput = document.querySelector('#human-count');

  document.querySelector('#start-sim').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    game = createGame({ mode: 'simulation', playerCount, humanPlayers: 0 });
    runSimulation(game);
    renderGame();
  });

  document.querySelector('#start-int').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const humanPlayers = Math.max(1, Math.min(playerCount, Number(humansInput.value) || 1));
    game = createGame({ mode: 'interactive', playerCount, humanPlayers });
    autoPlayUntilHumanOrEnd(game);
    renderGame();
  });
}

function renderLeaderboard() {
  const rows = scoreTable(game)
    .sort((a, b) => b.score.total - a.score.total)
    .map(
      ({ player, score }) => `
      <tr>
        <td>${player.name}${player.isHuman ? ' (Human)' : ' (AI)'}</td>
        <td>${score.total}</td>
        <td>${score.contractRenown}</td>
        <td>${score.setBonus}</td>
        <td>-${score.debtPenalty}</td>
        <td>${score.contracts}</td>
        <td>${score.money}</td>
        <td>${player.rewardsTriggered}</td>
      </tr>
    `,
    )
    .join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Total</th>
          <th>Contract</th>
          <th>Set</th>
          <th>Debt</th>
          <th>Done</th>
          <th>Coins</th>
          <th>Rewards</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderHumanControls(active) {
  const specialistCards = active.hand.filter((card) => card.kind === 'specialist');
  const contracts = active.hand.filter((card) => card.kind === 'contract');
  const selectedIds = game.humanState.selectedContractIds || [];

  if (game.humanState.step === 'market') {
    const specialists = specialistCards
      .map(
        (card) => `<button class="action" data-action="hire" data-id="${card.id}">Hire ${card.name} (${card.cost})</button>`,
      )
      .join('');

    const discharge = active.retinue
      .map(
        (card) => `<button class="action" data-action="fire" data-id="${card.id}">Discharge ${card.name}</button>`,
      )
      .join('');

    return `
      <section class="panel">
        <h3>Human Market Actions</h3>
        <div class="actions-grid">
          <button class="action" data-action="loan">Take Loan</button>
          <button class="action" data-action="buy-eq">Buy Equipment (1)</button>
          <button class="action" data-action="buy-market" data-type="melee">Buy Market Melee (2)</button>
          <button class="action" data-action="buy-market" data-type="ranged">Buy Market Ranged (3)</button>
          <button class="action" data-action="buy-market" data-type="mounted">Buy Market Mounted (4)</button>
          <button class="action" data-action="buy-supply" data-type="melee">Buy Supply Melee (4)</button>
          <button class="action" data-action="buy-supply" data-type="ranged">Buy Supply Ranged (6)</button>
          <button class="action" data-action="buy-supply" data-type="mounted">Buy Supply Mounted (8)</button>
          ${specialists}
          ${discharge}
        </div>
        <button class="primary" data-action="to-campaign">Finish Market</button>
      </section>
    `;
  }

  if (game.humanState.step === 'campaign') {
    const contractButtons = contracts
      .map(
        (card) => `
          <button class="action ${selectedIds.includes(card.id) ? 'selected' : ''}" data-action="toggle-contract" data-id="${card.id}">
            ${contractText(card)}
          </button>
        `,
      )
      .join('');

    return `
      <section class="panel">
        <h3>Human Campaign</h3>
        <p>Select up to 3 contracts. You may run with zero to skip.</p>
        <div class="contracts-list">${contractButtons || '<p>No contracts in hand.</p>'}</div>
        <button class="primary" data-action="run-campaign">Run Campaign</button>
      </section>
    `;
  }

  if (game.humanState.step === 'draw') {
    return `
      <section class="panel">
        <h3>Muster Draw (${game.humanState.drawChoicesRemaining} left)</h3>
        <div class="actions-grid">
          <button class="action" data-action="draw" data-source="offer:contract">Take Offer Contract</button>
          <button class="action" data-action="draw" data-source="offer:specialist">Take Offer Specialist</button>
          <button class="action" data-action="draw" data-source="offer:event">Take Offer Event</button>
          <button class="action" data-action="draw" data-source="deck:contract">Draw Contract Deck</button>
          <button class="action" data-action="draw" data-source="deck:specialist">Draw Specialist Deck</button>
          <button class="action" data-action="draw" data-source="deck:event">Draw Event Deck</button>
        </div>
      </section>
    `;
  }

  return '';
}

function renderGame() {
  if (!game) {
    renderStartScreen();
    return;
  }

  const active = getActivePlayer(game);
  const handContracts = active.hand.filter((card) => card.kind === 'contract');
  const handEvents = active.hand.filter((card) => card.kind === 'event');
  const handSpecialists = active.hand.filter((card) => card.kind === 'specialist');

  const controls = game.mode === 'interactive' && !game.isFinished && active.isHuman
    ? renderHumanControls(active)
    : '';

  const winner = game.winnerSummary?.[0];

  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <div class="topline">
          <h2>${game.mode === 'simulation' ? 'Simulation Results' : 'Interactive Game'}</h2>
          <button id="reset">New Game</button>
        </div>
        <p>Round ${game.round} | Active: ${active.name}${active.isHuman ? ' (Human)' : ' (AI)'} <span class="phase-badge">Current Phase: ${game.currentPhase || 'Event'}</span></p>
        <p class="meta">Contract data source: <a href="${CONTRACT_DATA_SYNC.sourceUrl}" target="_blank" rel="noreferrer">Google Sheet</a> | Last sync: ${CONTRACT_DATA_SYNC.syncedAt}</p>
        <p class="meta">Specialist data source: <a href="${SPECIALIST_DATA_SYNC.sourceUrl}" target="_blank" rel="noreferrer">Google Sheet</a> | Last sync: ${SPECIALIST_DATA_SYNC.syncedAt}</p>
        ${game.isFinished ? `<p class="winner">Winner: ${winner.player.name} (${winner.score.total} renown)</p>` : ''}
        ${renderLeaderboard()}
      </section>

      <section class="panel cols">
        <div>
          <h3>Active Player State</h3>
          <p>Coins: ${active.money} | Debt: ${active.debts} | Equipment: ${active.equipment} | Elite: ${active.elite}</p>
          <p>Troops: M${active.troops.melee} / R${active.troops.ranged} / Mo${active.troops.mounted}</p>
          <p>Retinue: ${active.retinue.map((s) => s.name).join(', ') || 'None'}</p>
          <p>Event in play: ${active.eventInPlay?.name || 'None'}</p>
          <h4>Hand</h4>
          <p>Contracts: ${handContracts.length} | Specialists: ${handSpecialists.length} | Events: ${handEvents.length}</p>
          <div class="contracts-list small">
            ${handContracts.slice(0, 8).map((card) => `<div class="chip">${contractText(card)}</div>`).join('')}
          </div>
        </div>
        <div>
          <h3>Shared Pools</h3>
          <p>Market: M${game.market.melee} / R${game.market.ranged} / Mo${game.market.mounted}</p>
          <p>Bag: M${game.bag.melee} / R${game.bag.ranged} / Mo${game.bag.mounted}</p>
          <p>Supply: M${game.supply.melee} / R${game.supply.ranged} / Mo${game.supply.mounted} / E${game.supply.elite}</p>
          <p>Armoury tokens: ${game.armoury}</p>
          <p>Contracts left in deck: ${game.contractDeck.length}</p>
          <p>Specialists left in deck: ${game.specialistDeck.length}</p>
          <h4>Offer</h4>
          <ul>
            <li>Contract: ${game.offer.contract.length}</li>
            <li>Specialist: ${game.offer.specialist.length}</li>
            <li>Event: ${game.offer.event.length}</li>
          </ul>
        </div>
      </section>

      ${controls}

      <section class="panel">
        <h3>This Turn Effects</h3>
        <div class="effects-list">
          ${renderTurnEffects()}
        </div>
      </section>

      <section class="panel">
        <h3>Turn Log</h3>
        <div class="log">
          ${game.log.map((line) => `<div>${line}</div>`).join('')}
        </div>
      </section>
    </main>
  `;

  document.querySelector('#reset').addEventListener('click', () => {
    game = null;
    renderStartScreen();
  });

  app.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      const type = button.dataset.type;
      const id = button.dataset.id;
      const source = button.dataset.source;

      if (action === 'loan') humanTakeLoan(game);
      if (action === 'buy-eq') humanBuyEquipment(game);
      if (action === 'buy-market') humanBuyTroop(game, 'market', type);
      if (action === 'buy-supply') humanBuyTroop(game, 'supply', type);
      if (action === 'hire') humanHireSpecialist(game, id);
      if (action === 'fire') humanDischargeSpecialist(game, id);
      if (action === 'to-campaign') humanProceedToCampaign(game);
      if (action === 'toggle-contract') humanToggleContractSelection(game, id);
      if (action === 'run-campaign') humanRunCampaign(game);
      if (action === 'draw') humanDrawCard(game, source);

      if (!game.isFinished && game.mode === 'interactive' && !getActivePlayer(game).isHuman) {
        autoPlayUntilHumanOrEnd(game);
      }

      renderGame();
    });
  });
}

renderStartScreen();
