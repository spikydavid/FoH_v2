import './style.css';
import {
  autoPlayUntilHumanOrEnd,
  createGame,
  getActivePlayer,
  runSimulation,
  runMultipleSimulations,
  scoreTable,
} from './gameEngine';
import {
  createGameV2,
  runMultipleSimulationsV2,
} from './gameEngineV2';
import { CONTRACT_DATA_SYNC } from './contractsData';
import { SPECIALIST_DATA_SYNC } from './specialistsData';
import { renderHumanControls, setupInteractiveEventListeners } from './interactiveMode';
import { renderHumanControls as renderHumanControlsV2, setupInteractiveEventListeners as setupInteractiveEventListenersV2 } from './interactiveModeV2';
import { renderProgressScreen, runBatchWithProgress, renderBatchResults } from './batchSimulation';
import { startSimulationMode } from './simulationMode';
import { startSimulationMode as startSimulationModeV2 } from './simulationModeV2';

const app = document.querySelector('#app');
let game = null;

const UI_ECONOMY_BY_RULESET = {
  classic: {
    troopCosts: {
      market: { melee: 2, ranged: 3, mounted: 4 },
      supply: { melee: 4, ranged: 6, mounted: 8 },
    },
    equipmentCost: 1,
    specialistHireSurcharge: 0,
    loanAmount: 10,
    label: 'Classic',
  },
  v2: {
    troopCosts: {
      market: { melee: 3, ranged: 4, mounted: 5 },
      supply: { melee: 5, ranged: 7, mounted: 9 },
    },
    equipmentCost: 2,
    specialistHireSurcharge: 1,
    loanAmount: 6,
    label: 'V2',
  },
};

function uiEconomyForRuleset(ruleset) {
  return UI_ECONOMY_BY_RULESET[ruleset] || UI_ECONOMY_BY_RULESET.classic;
}

function uiEconomyForGame(gameState) {
  return uiEconomyForRuleset(gameState?.ruleset || 'classic');
}

function labelForRuleset(ruleset) {
  return uiEconomyForRuleset(ruleset).label;
}

function gameApiForRuleset(ruleset) {
  if (ruleset === 'v2') {
    return {
      createGame: createGameV2,
      runMultipleSimulations: runMultipleSimulationsV2,
    };
  }
  return {
    createGame,
    runMultipleSimulations,
  };
}

function interactiveModeForRuleset(ruleset) {
  if (ruleset === 'v2') {
    return {
      renderHumanControls: renderHumanControlsV2,
      setupInteractiveEventListeners: setupInteractiveEventListenersV2,
    };
  }
  return {
    renderHumanControls,
    setupInteractiveEventListeners,
  };
}

function simulationModeForRuleset(ruleset) {
  if (ruleset === 'v2') {
    return {
      startSimulationMode: startSimulationModeV2,
    };
  }
  return {
    startSimulationMode,
  };
}

function contractText(card) {
  const reward = card.tier === 'R' && card.completionEffect ? ` | Reward: ${card.completionEffect.replace(/\*\*/g, '')}` : '';
  return `${card.title} (#${card.cardNumber}, ${card.tier}) ${card.type.toUpperCase()} [${card.region}] req M${card.requirements.melee}/R${card.requirements.ranged}/Mo${card.requirements.mounted} -> ${card.renown} renown, ${card.coins} coins${reward}`;
}

function renderTurnEffects() {
  if (!game.turnEffects || game.turnEffects.length === 0) {
    return '<div>No triggered effects yet this turn.</div>';
  }

  const phases = ['Income', 'Event', 'Enlist', 'Market', 'Campaign', 'Muster', 'General'];
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

function specialistText(card) {
  return `${card.name} (Tier ${card.tier}, cost ${card.cost}) — ${card.effect}`;
}

function eventText(card) {
  const ongoing = Object.entries(card.ongoing || {}).map(([k, v]) => {
    if (k === 'campaignCostDelta') return `Campaign cost ${v > 0 ? `+${v}` : v}`;
    if (k === 'contractBonus') return `${v.type.toUpperCase()} contracts +${v.coins} coin`;
    if (k === 'marketDrawDelta') return `Market draws ${v > 0 ? `+${v}` : v}`;
    if (k === 'endOfTurnDrawBonus') return `Draw +${v} card at end of turn`;
    if (k === 'meleeWildsDisabled') return `Melee 6s not wild`;
    if (k === 'guardFreeToAdd') return `GUARD free to add`;
    if (k === 'devastateFreeToAdd') return `DEVASTATE free to add`;
    if (k === 'recruitCostReduction') return `First recruit -${v} coin`;
    return null;
  }).filter(Boolean).join('; ');
  const roundEnd = card.roundEnd ? ` | Round end: ${card.roundEnd}` : '';
  return `${card.name} (Tier ${card.tier})${ongoing ? ` — ${ongoing}` : ''}${roundEnd}`;
}

function offerCardText(card) {
  if (card.kind === 'contract') return contractText(card);
  if (card.kind === 'specialist') return specialistText(card);
  if (card.kind === 'event') return eventText(card);
  return 'Unknown card';
}

function renderOffer() {
  const tierA = game.offer.A[0] ? `<div class="chip">${offerCardText(game.offer.A[0])}</div>` : '<em>None</em>';
  const tierB = game.offer.B[0] ? `<div class="chip">${offerCardText(game.offer.B[0])}</div>` : '<em>None</em>';
  const tierC = game.offer.C[0] ? `<div class="chip">${offerCardText(game.offer.C[0])}</div>` : '<em>None</em>';
  return `
    <h4>Offer</h4>
    <p><strong>Tier A:</strong></p><div class="contracts-list small">${tierA}</div>
    <p><strong>Tier B:</strong></p><div class="contracts-list small">${tierB}</div>
    <p><strong>Tier C:</strong></p><div class="contracts-list small">${tierC}</div>
  `;
}

function renderStartScreen() {
  app.innerHTML = `
    <main class="layout">
      <section class="panel hero">
        <h1>Field of Honour Simulator</h1>
        <p>Playable implementation based on the provided rule document with two modes.</p>
        <div class="sync-row">
          <span class="meta">Contracts: synced ${CONTRACT_DATA_SYNC.syncedAt}</span>
          <button id="sync-contracts" class="sync-btn">↻ Resync Contracts</button>
          <span id="sync-contracts-status" class="sync-status"></span>
        </div>
        <div class="sync-row">
          <span class="meta">Specialists: synced ${SPECIALIST_DATA_SYNC.syncedAt}</span>
          <button id="sync-specialists" class="sync-btn">↻ Resync Specialists</button>
          <span id="sync-specialists-status" class="sync-status"></span>
        </div>
        <div class="mode-buttons">
          <h3>Classic Ruleset</h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-sim-classic">Simulation Mode (AI only)</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-int-classic">Interactive Mode (humans + AI)</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-batch-classic">Batch Simulation</button>
          </div>
          <h3>V2 Ruleset</h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-sim-v2">Simulation Mode (AI only)</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-int-v2">Interactive Mode (humans + AI)</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-batch-v2">Batch Simulation</button>
          </div>
        </div>
        <form id="config-form">
          <label>Players (2-4)
            <input id="player-count" type="number" min="2" max="4" value="4" />
          </label>
          <label>Human players (0-4)
            <input id="human-count" type="number" min="0" max="4" value="1" />
          </label>
          <label>Batch runs
            <input id="batch-count" type="number" min="1" max="100000" value="1000" />
          </label>
          <label>
            <input id="disable-events" type="checkbox" checked /> Disable events
          </label>
          <label>Player 1 AI model
            <select id="batch-ai-1">
              <option value="aggressive">Aggressive</option>
              <option value="forward">Forward</option>
              <option value="steady" selected>Steady</option>
              <option value="conservative">Conservative</option>
            </select>
          </label>
          <label>Player 2 AI model
            <select id="batch-ai-2">
              <option value="aggressive">Aggressive</option>
              <option value="forward">Forward</option>
              <option value="steady" selected>Steady</option>
              <option value="conservative">Conservative</option>
            </select>
          </label>
          <label>Player 3 AI model
            <select id="batch-ai-3">
              <option value="aggressive">Aggressive</option>
              <option value="forward">Forward</option>
              <option value="steady" selected>Steady</option>
              <option value="conservative">Conservative</option>
            </select>
          </label>
          <label>Player 4 AI model
            <select id="batch-ai-4">
              <option value="aggressive">Aggressive</option>
              <option value="forward">Forward</option>
              <option value="steady" selected>Steady</option>
              <option value="conservative">Conservative</option>
            </select>
          </label>
        </form>
      </section>
    </main>
  `;

  const playersInput = document.querySelector('#player-count');
  const humansInput = document.querySelector('#human-count');

  // Classic Ruleset Handlers
  document.querySelector('#start-sim-classic').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const disableEvents = document.querySelector('#disable-events').checked;
    const api = gameApiForRuleset('classic');
    const simMode = simulationModeForRuleset('classic');
    simMode.startSimulationMode(app, { playerCount, disableEvents }, 'classic', api, renderGame);
  });

  document.querySelector('#start-int-classic').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const humanPlayers = Math.max(1, Math.min(playerCount, Number(humansInput.value) || 1));
    const disableEvents = document.querySelector('#disable-events').checked;
    const api = gameApiForRuleset('classic');
    game = api.createGame({ mode: 'interactive', playerCount, humanPlayers, disableEvents });
    autoPlayUntilHumanOrEnd(game);
    renderGame();
  });

  document.querySelector('#start-batch-classic').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const batchCount = Math.max(1, Math.min(100000, Number(document.querySelector('#batch-count').value) || 1000));
    const disableEvents = document.querySelector('#disable-events').checked;
    const api = gameApiForRuleset('classic');
    const aiModels = [
      document.querySelector('#batch-ai-1').value,
      document.querySelector('#batch-ai-2').value,
      document.querySelector('#batch-ai-3').value,
      document.querySelector('#batch-ai-4').value,
    ].slice(0, playerCount);
    runBatchWithProgress(app, { playerCount, aiModels, disableEvents }, batchCount, api.runMultipleSimulations, 'classic', (results, batchRuleset) => {
      renderBatchResults(app, results, batchRuleset, labelForRuleset, renderStartScreen);
    });
  });

  // V2 Ruleset Handlers
  document.querySelector('#start-sim-v2').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const disableEvents = document.querySelector('#disable-events').checked;
    const api = gameApiForRuleset('v2');
    const simMode = simulationModeForRuleset('v2');
    simMode.startSimulationMode(app, { playerCount, disableEvents }, 'v2', api, renderGame);
  });

  document.querySelector('#start-int-v2').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const humanPlayers = Math.max(1, Math.min(playerCount, Number(humansInput.value) || 1));
    const disableEvents = document.querySelector('#disable-events').checked;
    const api = gameApiForRuleset('v2');
    game = api.createGame({ mode: 'interactive', playerCount, humanPlayers, disableEvents });
    autoPlayUntilHumanOrEnd(game);
    renderGame();
  });

  document.querySelector('#start-batch-v2').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const batchCount = Math.max(1, Math.min(100000, Number(document.querySelector('#batch-count').value) || 1000));
    const disableEvents = document.querySelector('#disable-events').checked;
    const api = gameApiForRuleset('v2');
    const aiModels = [
      document.querySelector('#batch-ai-1').value,
      document.querySelector('#batch-ai-2').value,
      document.querySelector('#batch-ai-3').value,
      document.querySelector('#batch-ai-4').value,
    ].slice(0, playerCount);
    runBatchWithProgress(app, { playerCount, aiModels, disableEvents }, batchCount, api.runMultipleSimulations, 'v2', (results, batchRuleset) => {
      renderBatchResults(app, results, batchRuleset, labelForRuleset, renderStartScreen);
    });
  });

  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

  async function doSync(endpoint, btnId, statusId) {
    const btn = document.querySelector(`#${btnId}`);
    const status = document.querySelector(`#${statusId}`);
    btn.disabled = true;
    btn.textContent = '⏳ Syncing…';
    status.textContent = '';
    status.className = 'sync-status';
    try {
      const res = await fetch(`${apiBaseUrl}/api/${endpoint}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        status.textContent = `✓ ${json.count} cards synced (${json.syncedAt}). Reload the page to apply.`;
        status.className = 'sync-status sync-ok';
      } else {
        status.textContent = `✗ ${json.error}`;
        status.className = 'sync-status sync-err';
      }
    } catch (err) {
      status.textContent = `✗ Could not reach backend: ${err.message}`;
      status.className = 'sync-status sync-err';
    } finally {
      btn.disabled = false;
      btn.textContent = btn.id === 'sync-contracts' ? '↻ Resync Contracts' : '↻ Resync Specialists';
    }
  }

  document.querySelector('#sync-contracts').addEventListener('click', () => doSync('sync/contracts', 'sync-contracts', 'sync-contracts-status'));
  document.querySelector('#sync-specialists').addEventListener('click', () => doSync('sync/specialists', 'sync-specialists', 'sync-specialists-status'));
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

function renderGame() {
  if (!game) {
    renderStartScreen();
    return;
  }

  const active = getActivePlayer(game);
  const handContracts = active.hand.filter((card) => card.kind === 'contract');
  const handEvents = active.hand.filter((card) => card.kind === 'event');
  const handSpecialists = active.hand.filter((card) => card.kind === 'specialist');
  const tierCount = (tier, kind) =>
    (game.tierDecks?.[tier] || []).filter((card) => card.kind === kind).length;
  const totalContracts = tierCount('A', 'contract') + tierCount('B', 'contract') + tierCount('C', 'contract');
  const totalSpecialists = tierCount('A', 'specialist') + tierCount('B', 'specialist') + tierCount('C', 'specialist');
  const totalEvents = tierCount('A', 'event') + tierCount('B', 'event') + tierCount('C', 'event');

  const intMode = interactiveModeForRuleset(game.ruleset || 'classic');
  const controls = game.mode === 'interactive' && !game.isFinished && active.isHuman
    ? intMode.renderHumanControls(game, uiEconomyForGame)
    : '';

  const winner = game.winnerSummary?.[0];

  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <div class="topline">
          <h2>${game.mode === 'simulation' ? 'Simulation Results' : 'Interactive Game'}</h2>
          <button id="reset">New Game</button>
        </div>
        <p class="meta">Ruleset: ${labelForRuleset(game.ruleset || 'classic')}</p>
        <p>Round ${game.round} | Active: ${active.name}${active.isHuman ? ' (Human)' : ' (AI)'} <span class="phase-badge">Current Phase: ${game.currentPhase || 'Event'}</span></p>
        <p class="meta">Contract data source: <a href="${CONTRACT_DATA_SYNC.sourceUrl}" target="_blank" rel="noreferrer">Google Sheet</a> | Last sync: ${CONTRACT_DATA_SYNC.syncedAt}</p>
        <p class="meta">Specialist data source: <a href="${SPECIALIST_DATA_SYNC.sourceUrl}" target="_blank" rel="noreferrer">Google Sheet</a> | Last sync: ${SPECIALIST_DATA_SYNC.syncedAt}</p>
        ${game.isFinished ? `<p class="winner">Winner: ${winner.player.name} (${winner.score.total} renown)</p>` : ''}
        ${renderLeaderboard()}
      </section>

      <section class="panel cols">
        <div>
          <h3>Common Resources</h3>
          <p>Market: M${game.market.melee} / R${game.market.ranged} / Mo${game.market.mounted}</p>
          <p>Bag: M${game.bag.melee} / R${game.bag.ranged} / Mo${game.bag.mounted}</p>
          <p>Supply: M${game.supply.melee} / R${game.supply.ranged} / Mo${game.supply.mounted} / E${game.supply.elite}</p>
          <p>Armoury tokens: ${game.armoury}</p>
          <p>Tier A deck: C${tierCount('A', 'contract')} / S${tierCount('A', 'specialist')} / E${tierCount('A', 'event')}</p>
          <p>Tier B deck: C${tierCount('B', 'contract')} / S${tierCount('B', 'specialist')} / E${tierCount('B', 'event')}</p>
          <p>Tier C deck: C${tierCount('C', 'contract')} / S${tierCount('C', 'specialist')} / E${tierCount('C', 'event')}</p>
          <p>Main decks total: C${totalContracts} / S${totalSpecialists} / E${totalEvents}</p>
          <p>Rewards deck (Tier R contracts): ${game.rewardsDeck.length}</p>
        </div>
        <div>
          ${renderOffer()}
        </div>
      </section>

      <section class="panel hand-panel">
        <h3>Hand</h3>
        <p>Contracts: ${handContracts.length} | Specialists: ${handSpecialists.length} | Events: ${handEvents.length}</p>
        <div class="hand-strip">
          ${handContracts.map((card) => `<div class="chip">${contractText(card)}</div>`).join('') || '<em>No contracts in hand.</em>'}
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

  intMode.setupInteractiveEventListeners(game, renderGame);
}

renderStartScreen();
