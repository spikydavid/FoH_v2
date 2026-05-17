import './style.css';
import {
  autoPlayUntilHumanOrEnd,
  beginInteractiveTurn,
  createGame,
  getActivePlayer,
  humanBuyEquipment,
  humanBuyTroop,
  humanConfirmBattle,
  humanToggleSacrifice,
  humanDischargeSpecialist,
  contractCost,
  humanDrawCard,
  humanHireSpecialist,
  humanProceedToCampaign,
  humanRerollDie,
  humanRunCampaign,
  humanTakeLoan,
  humanToggleContractSelection,
  humanUndo,
  previewBattleOutcome,
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

const app = document.querySelector('#app');
let game = null;
let batchResults = null;
let batchRuleset = 'classic';

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
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-sim">Simulation Mode (AI only)</button>
            <span id="badge-sim" class="ruleset-badge" style="background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap;"></span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-int">Interactive Mode (humans + AI)</button>
            <span id="badge-int" class="ruleset-badge" style="background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap;"></span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="start-batch">Batch Simulation</button>
            <span id="badge-batch" class="ruleset-badge" style="background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap;"></span>
          </div>
        </div>
        <form id="config-form">
          <label>Ruleset
            <select id="ruleset">
              <option value="classic" selected>Classic</option>
              <option value="v2">V2 (new market + income)</option>
            </select>
          </label>
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
  const rulesetInput = document.querySelector('#ruleset');

  function selectedRuleset() {
    return rulesetInput?.value === 'v2' ? 'v2' : 'classic';
  }

  function updateRulesetBadges() {
    const rulesetLabel = labelForRuleset(selectedRuleset());
    document.querySelector('#badge-sim').textContent = rulesetLabel;
    document.querySelector('#badge-int').textContent = rulesetLabel;
    document.querySelector('#badge-batch').textContent = rulesetLabel;
  }

  updateRulesetBadges();

  rulesetInput.addEventListener('change', updateRulesetBadges);

  document.querySelector('#start-sim').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const disableEvents = document.querySelector('#disable-events').checked;
    const ruleset = selectedRuleset();
    const api = gameApiForRuleset(ruleset);
    try {
      game = api.createGame({ mode: 'simulation', playerCount, humanPlayers: 0, disableEvents });
      runSimulation(game);
      renderGame();
    } catch (err) {
      console.error('Simulation error:', err);
      app.innerHTML = `<main class="layout"><section class="panel"><h2>Error: ${err.message}</h2><pre>${err.stack}</pre></section></main>`;
    }
  });

  document.querySelector('#start-int').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const humanPlayers = Math.max(1, Math.min(playerCount, Number(humansInput.value) || 1));
    const disableEvents = document.querySelector('#disable-events').checked;
    const ruleset = selectedRuleset();
    const api = gameApiForRuleset(ruleset);
    game = api.createGame({ mode: 'interactive', playerCount, humanPlayers, disableEvents });
    autoPlayUntilHumanOrEnd(game);
    renderGame();
  });

  document.querySelector('#start-batch').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const batchCount = Math.max(1, Math.min(100000, Number(document.querySelector('#batch-count').value) || 1000));
    const disableEvents = document.querySelector('#disable-events').checked;
    const ruleset = selectedRuleset();
    const api = gameApiForRuleset(ruleset);
    const aiModels = [
      document.querySelector('#batch-ai-1').value,
      document.querySelector('#batch-ai-2').value,
      document.querySelector('#batch-ai-3').value,
      document.querySelector('#batch-ai-4').value,
    ].slice(0, playerCount);
    runBatchWithProgress({ playerCount, aiModels, disableEvents }, batchCount, api.runMultipleSimulations, ruleset);
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

function renderProgressScreen(done, total) {
  const pct = Math.round((done / total) * 100);
  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <h2>Running Batch Simulation…</h2>
        <p>${done} / ${total} games complete</p>
        <div class="batch-bar-track" style="margin-top:12px;max-width:480px">
          <div class="batch-bar-fill" style="width:${pct}%"></div>
        </div>
        <p class="meta" style="margin-top:8px">${pct}%</p>
      </section>
    </main>
  `;
}

const CHUNK_SIZE = 20; // simulations per async tick

function runBatchWithProgress(config, total, runMultiple, ruleset) {
  batchResults = [];
  batchRuleset = ruleset || 'classic';
  renderProgressScreen(0, total);

  function runChunk() {
    const chunkEnd = Math.min(batchResults.length + CHUNK_SIZE, total);
    try {
      const chunk = runMultiple(config, chunkEnd - batchResults.length);
      // Renumber gameIndex to be sequential across chunks
      const offset = batchResults.length;
      for (const r of chunk) r.gameIndex = offset + r.gameIndex;
      batchResults.push(...chunk);
    } catch (err) {
      console.error('Batch simulation error:', err);
      app.innerHTML = `<main class="layout"><section class="panel"><h2>Error: ${err.message}</h2><pre>${err.stack}</pre></section></main>`;
      return;
    }

    if (batchResults.length < total) {
      renderProgressScreen(batchResults.length, total);
      setTimeout(runChunk, 0);
    } else {
      renderBatchResults();
    }
  }

  setTimeout(runChunk, 0);
}

function renderBatchResults() {
  const results = batchResults;
  const n = results.length;
  if (n === 0) return;

  // Derive player names from first game ranking (same names across all games)
  const playerNames = results[0].ranking.map((r) => r.name);

  // Track win rate per player, and all other metrics by finishing position.
  const playerWins = {};
  const playerContractStats = {};
  for (const name of playerNames) playerWins[name] = 0;
  for (const name of playerNames) {
    playerContractStats[name] = { successes: 0, attempts: 0 };
  }

  const placeStats = results[0].ranking.map(() => ({
    totalScore: 0,
    totalTurns: 0,
    totalContractsPerCampaign: 0,
    totalContracts: 0,
    totalContractsAttempted: 0,
    totalContractRenown: 0,
    totalSetBonus: 0,
    totalHuntBonus: 0,
    totalDebtPenalty: 0,
    totalTierA: 0,
    totalTierB: 0,
    totalTierC: 0,
    totalTierR: 0,
    totalMelee: 0,
    totalRanged: 0,
    totalMounted: 0,
    totalMoney: 0,
    totalEquipment: 0,
  }));

  for (const result of results) {
    const winner = result.ranking[0];
    playerWins[winner.name] += 1;
    for (let i = 0; i < result.ranking.length; i += 1) {
      const entry = result.ranking[i];
      const pcs = playerContractStats[entry.name];
      pcs.successes += entry.score.contracts || 0;
      pcs.attempts += entry.score.selectedContracts || 0;

      const s = placeStats[i];
      s.totalScore += entry.score.total;
      s.totalTurns += (entry.score.turns || 0);
      s.totalContractsPerCampaign += (entry.score.contractsPerCampaign || 0);
      s.totalContracts += entry.score.contracts;
      s.totalContractsAttempted += (entry.score.selectedContracts || 0);
      s.totalContractRenown += entry.score.contractRenown;
      s.totalSetBonus += entry.score.setBonus;
      s.totalHuntBonus += (entry.score.huntBonus || 0);
      s.totalDebtPenalty += entry.score.debtPenalty;
      s.totalTierA += (entry.score.tierCounts?.A || 0);
      s.totalTierB += (entry.score.tierCounts?.B || 0);
      s.totalTierC += (entry.score.tierCounts?.C || 0);
      s.totalTierR += (entry.score.tierCounts?.R || 0);
      s.totalMelee += (entry.score.troopCounts?.melee || 0);
      s.totalRanged += (entry.score.troopCounts?.ranged || 0);
      s.totalMounted += (entry.score.troopCounts?.mounted || 0);
      s.totalMoney += entry.score.money;
      s.totalEquipment += (entry.score.equipment || 0);
    }
  }

  // Average board state after each turn across all simulations.
  const turnAgg = [];
  for (const result of results) {
    const states = result.turnStates || [];
    for (let i = 0; i < states.length; i += 1) {
      const st = states[i];
      if (!turnAgg[i]) {
        turnAgg[i] = {
          count: 0,
          marketMelee: 0,
          marketRanged: 0,
          marketMounted: 0,
          bagMelee: 0,
          bagRanged: 0,
          bagMounted: 0,
          supplyMelee: 0,
          supplyRanged: 0,
          supplyMounted: 0,
          armoury: 0,
          offerA: 0,
          offerB: 0,
          offerC: 0,
          deckA: 0,
          deckB: 0,
          deckC: 0,
          deckR: 0,
          playerEquipment: [],
        };
      }
      const a = turnAgg[i];
      a.count += 1;
      a.marketMelee += st.market?.melee || 0;
      a.marketRanged += st.market?.ranged || 0;
      a.marketMounted += st.market?.mounted || 0;
      a.bagMelee += st.bag?.melee || 0;
      a.bagRanged += st.bag?.ranged || 0;
      a.bagMounted += st.bag?.mounted || 0;
      a.supplyMelee += st.supply?.melee || 0;
      a.supplyRanged += st.supply?.ranged || 0;
      a.supplyMounted += st.supply?.mounted || 0;
      a.armoury += st.armoury || 0;
      a.offerA += st.offer?.A || 0;
      a.offerB += st.offer?.B || 0;
      a.offerC += st.offer?.C || 0;
      a.deckA += st.decks?.A || 0;
      a.deckB += st.decks?.B || 0;
      a.deckC += st.decks?.C || 0;
      a.deckR += st.decks?.R || 0;
      if (st.playerEquipment) {
        for (let pi = 0; pi < st.playerEquipment.length; pi += 1) {
          if (a.playerEquipment[pi] === undefined) a.playerEquipment[pi] = 0;
          a.playerEquipment[pi] += st.playerEquipment[pi] || 0;
        }
      }
    }
  }

  const avgTurnRows = turnAgg.map((a, i) => {
    const denom = a.count || 1;
    const mM = (a.marketMelee / denom).toFixed(2);
    const mR = (a.marketRanged / denom).toFixed(2);
    const mMo = (a.marketMounted / denom).toFixed(2);
    const bM = (a.bagMelee / denom).toFixed(2);
    const bR = (a.bagRanged / denom).toFixed(2);
    const bMo = (a.bagMounted / denom).toFixed(2);
    const sM = (a.supplyMelee / denom).toFixed(2);
    const sR = (a.supplyRanged / denom).toFixed(2);
    const sMo = (a.supplyMounted / denom).toFixed(2);
    const oA = (a.offerA / denom).toFixed(2);
    const oB = (a.offerB / denom).toFixed(2);
    const oC = (a.offerC / denom).toFixed(2);
    const dA = (a.deckA / denom).toFixed(2);
    const dB = (a.deckB / denom).toFixed(2);
    const dC = (a.deckC / denom).toFixed(2);
    const dR = (a.deckR / denom).toFixed(2);
    const armouryAvg = (a.armoury / denom).toFixed(2);
    const playerEqCells = (a.playerEquipment || []).map((total) => `<td>${(total / denom).toFixed(2)}</td>`).join('');
    const marketTotal = ((a.marketMelee + a.marketRanged + a.marketMounted) / denom).toFixed(2);
    const bagTotal = ((a.bagMelee + a.bagRanged + a.bagMounted) / denom).toFixed(2);
    const supplyTotal = ((a.supplyMelee + a.supplyRanged + a.supplyMounted) / denom).toFixed(2);
    const offerTotal = ((a.offerA + a.offerB + a.offerC) / denom).toFixed(2);
    const deckTotal = ((a.deckA + a.deckB + a.deckC + a.deckR) / denom).toFixed(2);
    return `<tr>
      <td>${i + 1}</td>
      <td>${mM}</td><td>${mR}</td><td>${mMo}</td><td>${marketTotal}</td>
      <td>${bM}</td><td>${bR}</td><td>${bMo}</td><td>${bagTotal}</td>
      <td>${sM}</td><td>${sR}</td><td>${sMo}</td><td>${supplyTotal}</td>
      <td>${armouryAvg}</td>
      ${playerEqCells}
      <td>${oA}</td><td>${oB}</td><td>${oC}</td><td>${offerTotal}</td>
      <td>${dA}</td><td>${dB}</td><td>${dC}</td><td>${dR}</td><td>${deckTotal}</td>
      <td>${a.count}</td>
    </tr>`;
  }).join('');

  const avg = (total) => (total / n).toFixed(1);
  const pct = (wins) => ((wins / n) * 100).toFixed(1);
  const ratePct = (successes, attempts) => (attempts > 0 ? ((successes / attempts) * 100).toFixed(1) : '0.0');
  const chartPlayerNames = [...playerNames].sort((a, b) => {
    const aNum = Number((a.match(/\d+/) || [])[0]);
    const bNum = Number((b.match(/\d+/) || [])[0]);
    const aHasNum = Number.isFinite(aNum);
    const bHasNum = Number.isFinite(bNum);
    if (aHasNum && bHasNum) return aNum - bNum;
    if (aHasNum) return -1;
    if (bHasNum) return 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });

  const placeLabel = (i) => {
    if (i === 0) return '1st';
    if (i === 1) return '2nd';
    if (i === 2) return '3rd';
    return `${i + 1}th`;
  };

  // Position summary table (winner/2nd/3rd/4th performance)
  const summaryRows = placeStats.map((s, i) => {
    const placeCompletionPct = ratePct(s.totalContracts, s.totalContractsAttempted);
    return `<tr>
      <td>${placeLabel(i)}</td>
      <td>${avg(s.totalScore)}</td>
      <td>${avg(s.totalTurns)}</td>
      <td>${avg(s.totalContractsPerCampaign)}</td>
      <td>${avg(s.totalContracts)}</td>
      <td>${placeCompletionPct}%</td>
      <td>${avg(s.totalContractRenown)}</td>
      <td>${avg(s.totalSetBonus)}</td>
      <td>${avg(s.totalHuntBonus)}</td>
      <td>-${avg(s.totalDebtPenalty)}</td>
      <td>${avg(s.totalTierA)}</td>
      <td>${avg(s.totalTierB)}</td>
      <td>${avg(s.totalTierC)}</td>
      <td>${avg(s.totalTierR)}</td>
      <td>${avg(s.totalMelee)}</td>
      <td>${avg(s.totalRanged)}</td>
      <td>${avg(s.totalMounted)}</td>
      <td>${avg(s.totalMoney)}</td>
      <td>${avg(s.totalEquipment)}</td>
    </tr>`;
  }).join('');

  const firstPlace = placeStats[0] || { totalContracts: 0, totalContractsAttempted: 0 };
  const lastPlace = placeStats[placeStats.length - 1] || { totalContracts: 0, totalContractsAttempted: 0 };
  const firstCompletion = Number(ratePct(firstPlace.totalContracts, firstPlace.totalContractsAttempted));
  const lastCompletion = Number(ratePct(lastPlace.totalContracts, lastPlace.totalContractsAttempted));
  const completionDelta = (firstCompletion - lastCompletion).toFixed(1);

  // Separate per-player win-rate summary.
  const winSummaryRows = chartPlayerNames.map((name) => {
    const wins = playerWins[name];
    const contractStats = playerContractStats[name];
    return `<tr>
      <td>${name}</td>
      <td><strong>${wins}</strong></td>
      <td>${pct(wins)}%</td>
      <td>${contractStats.successes}</td>
      <td>${contractStats.attempts}</td>
      <td>${ratePct(contractStats.successes, contractStats.attempts)}%</td>
    </tr>`;
  }).join('');

  const globalContractSuccess = Object.values(playerContractStats).reduce(
    (acc, s) => {
      acc.successes += s.successes;
      acc.attempts += s.attempts;
      return acc;
    },
    { successes: 0, attempts: 0 },
  );

  // Game length distribution (total player-turns per game).
  const gameTurnCounts = results.map((r) => (r.turnStates || []).length);
  const minGameTurns = Math.min(...gameTurnCounts);
  const maxGameTurns = Math.max(...gameTurnCounts);
  const turnFrequency = new Map();
  for (const turns of gameTurnCounts) {
    turnFrequency.set(turns, (turnFrequency.get(turns) || 0) + 1);
  }

  const turnDistribution = [];
  for (let t = minGameTurns; t <= maxGameTurns; t += 1) {
    const count = turnFrequency.get(t) || 0;
    turnDistribution.push({
      turns: t,
      count,
      proportion: count / n,
    });
  }

  const representedTurns = turnDistribution.filter((d) => d.proportion > 0);
  const turnColorMap = new Map();
  for (let i = 0; i < representedTurns.length; i += 1) {
    const d = representedTurns[i];
    // Golden-angle spacing gives clearly distinct colors even with many slices.
    const hue = Math.round((i * 137.508) % 360);
    turnColorMap.set(d.turns, `hsl(${hue} 72% 55%)`);
  }

  let pieStart = 0;
  const pieStops = representedTurns
    .map((d) => {
      const color = turnColorMap.get(d.turns) || '#e5e5e5';
      const from = (pieStart * 100).toFixed(2);
      pieStart += d.proportion;
      const to = (pieStart * 100).toFixed(2);
      return { turns: d.turns, color, from, to, count: d.count, proportion: d.proportion };
    });
  const pieGradient = pieStops.length > 0
    ? `conic-gradient(${pieStops.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`
    : 'conic-gradient(#ddd 0% 100%)';
  const turnLegendRows = turnDistribution.map((d) => {
    const swatch = turnColorMap.get(d.turns) || '#e5e5e5';
    return `<tr>
      <td><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${swatch};vertical-align:middle"></span> ${d.turns}</td>
      <td>${d.count}</td>
      <td>${(d.proportion * 100).toFixed(2)}%</td>
    </tr>`;
  }).join('');

  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <h2>Batch Simulation Results (${n} games)</h2>
        <p class="meta">Ruleset: ${labelForRuleset(batchRuleset)}</p>
        <button id="batch-back">← Back to Start</button>

        <h3>Summary</h3>
        <p class="meta">Contract completion by place: 1st ${firstCompletion.toFixed(1)}% vs ${placeLabel(placeStats.length - 1)} ${lastCompletion.toFixed(1)}% (delta ${completionDelta} pts).</p>
        <table>
          <thead><tr><th>Place</th><th>Avg Score</th><th>Avg Turns</th><th>Avg Contracts/Campaign</th><th>Avg Contracts</th><th>Completion %</th><th>Avg Renown</th><th>Avg Sets</th><th>Avg Hunt</th><th>Avg Debt</th><th>Avg Tier A</th><th>Avg Tier B</th><th>Avg Tier C</th><th>Avg Tier R</th><th>Avg Melee</th><th>Avg Ranged</th><th>Avg Mounted</th><th>Avg Coins</th><th>Avg Equipment</th></tr></thead>
          <tbody>${summaryRows}</tbody>
        </table>

        <h3>Player Win Summary</h3>
        <table>
          <thead><tr><th>Player</th><th>Wins</th><th>Win Rate</th><th>Contracts Completed</th><th>Contracts Attempted</th><th>Contract Success Rate</th></tr></thead>
          <tbody>${winSummaryRows}</tbody>
        </table>

        <h3>Global Contract Success</h3>
        <p class="meta">${globalContractSuccess.successes} completed out of ${globalContractSuccess.attempts} attempted (${ratePct(globalContractSuccess.successes, globalContractSuccess.attempts)}%).</p>

        <h3>Game Length Distribution</h3>
        <p class="meta">Minimum turns: <strong>${minGameTurns}</strong> | Maximum turns: <strong>${maxGameTurns}</strong></p>
        <div class="sync-row" style="align-items:flex-start;gap:20px">
          <div style="width:260px;height:260px;border-radius:50%;background:${pieGradient};border:1px solid #ddd;flex:0 0 auto"></div>
          <div class="batch-table-scroll" style="max-height:260px;min-width:280px">
            <table>
              <thead><tr><th>Turns</th><th>Games</th><th>Proportion</th></tr></thead>
              <tbody>${turnLegendRows}</tbody>
            </table>
          </div>
        </div>

        <h3>Win Rate Chart</h3>
        <div class="batch-bars">
          ${chartPlayerNames.map((name) => {
            const winPct = (playerWins[name] / n) * 100;
            return `<div class="batch-bar-row">
              <span class="batch-bar-label">${name}</span>
              <div class="batch-bar-track">
                <div class="batch-bar-fill" style="width:${winPct.toFixed(1)}%"></div>
              </div>
              <span class="batch-bar-pct">${winPct.toFixed(1)}%</span>
            </div>`;
          }).join('')}
        </div>

        <h3>Average Game State By Turn</h3>
        <p class="meta">Averages are taken after each player turn. Samples drop on later turns as games finish.</p>
        <div class="batch-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Turn</th>
                <th>Mkt M</th><th>Mkt R</th><th>Mkt Mo</th><th>Mkt Total</th>
                <th>Bag M</th><th>Bag R</th><th>Bag Mo</th><th>Bag Total</th>
                <th>Sup M</th><th>Sup R</th><th>Sup Mo</th><th>Sup Total</th>
                <th>Armoury</th>
                <th>P1 Equip</th><th>P2 Equip</th><th>P3 Equip</th><th>P4 Equip</th>
                <th>Off A</th><th>Off B</th><th>Off C</th><th>Off Total</th>
                <th>Deck A</th><th>Deck B</th><th>Deck C</th><th>Deck R</th><th>Deck Total</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>${avgTurnRows}</tbody>
          </table>
        </div>
      </section>
    </main>
  `;

  document.querySelector('#batch-back').addEventListener('click', () => {
    batchResults = null;
    renderStartScreen();
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
  const economy = uiEconomyForGame(game);
  const marketCosts = economy.troopCosts.market;
  const supplyCosts = economy.troopCosts.supply;
  const specialistSurcharge = economy.specialistHireSurcharge;

  const specialistCards = active.hand.filter((card) => card.kind === 'specialist');
  const contracts = active.hand.filter((card) => card.kind === 'contract');
  const selectedIds = game.humanState.selectedContractIds || [];

  if (game.humanState.step === 'market') {
    const specialistRulesText = (card) => (card.effect || 'No specialist rule text available.')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const specialists = specialistCards
      .map(
        (card) => `
          <div class="specialist-row">
            <button class="action" data-action="hire" data-id="${card.id}" title="${specialistRulesText(card)}">Hire ${card.name} (${card.cost + specialistSurcharge})</button>
            <span class="info-tip" data-tip="${specialistRulesText(card)}" aria-label="${card.name} rule">i</span>
          </div>
        `,
      )
      .join('');

    const discharge = active.retinue
      .map(
        (card) => `<button class="action" data-action="fire" data-id="${card.id}">Discharge ${card.name}</button>`,
      )
      .join('');

    const canUndo = (game.undoStack || []).length > 0;
    return `
      <section class="panel">
        <h3>Human Market Actions</h3>
        <div class="market-resources meta">
          <div><strong>Coins:</strong> ${active.money} | <strong>Debt:</strong> ${active.debts} | <strong>Equipment:</strong> ${active.equipment}</div>
          <div><strong>Your Troops:</strong> M${active.troops.melee}/R${active.troops.ranged}/Mo${active.troops.mounted}</div>
          <div><strong>Market:</strong> M${game.market.melee}/R${game.market.ranged}/Mo${game.market.mounted} | <strong>Supply:</strong> M${game.supply.melee}/R${game.supply.ranged}/Mo${game.supply.mounted} | <strong>Armoury:</strong> ${game.armoury}</div>
        </div>

        <div class="market-layout">
          <div class="market-panel-box">
            <h4>Market & Equipment</h4>
            <div class="market-column">
              <button class="action" data-action="buy-eq">Buy Equipment (${economy.equipmentCost})</button>
              <button class="action" data-action="buy-market" data-type="melee">Buy Market Melee (${marketCosts.melee})</button>
              <button class="action" data-action="buy-market" data-type="ranged">Buy Market Ranged (${marketCosts.ranged})</button>
              <button class="action" data-action="buy-market" data-type="mounted">Buy Market Mounted (${marketCosts.mounted})</button>
            </div>
          </div>

          <div class="market-panel-box">
            <h4>Supply Purchases</h4>
            <div class="market-column">
              <button class="action" data-action="buy-supply" data-type="melee">Buy Supply Melee (${supplyCosts.melee})</button>
              <button class="action" data-action="buy-supply" data-type="ranged">Buy Supply Ranged (${supplyCosts.ranged})</button>
              <button class="action" data-action="buy-supply" data-type="mounted">Buy Supply Mounted (${supplyCosts.mounted})</button>
            </div>
          </div>

          <div class="market-panel-box">
            <h4>Hire Specialists</h4>
            <div class="market-column">
              ${specialists || '<p class="meta">No specialists in hand.</p>'}
            </div>
          </div>

          <div class="market-panel-box">
            <h4>Discharge Retinue</h4>
            <div class="market-column">
              ${discharge || '<p class="meta">No specialists in retinue.</p>'}
            </div>
          </div>

          <div class="market-panel-box offer-actions-box">
            <h4>Offer Actions</h4>
            <div class="market-column">
              <button class="action" data-action="loan">Take Loan (+${economy.loanAmount})</button>
              <button class="primary" data-action="to-campaign">Finish Market</button>
              <button class="action undo-btn" data-action="undo" ${canUndo ? '' : 'disabled'}>↩ Undo</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  if (game.humanState.step === 'campaign') {
    const eventCostDelta = active.eventInPlay?.ongoing?.campaignCostDelta || 0;
    const specialistDiscount = (active.retinue.filter((s) => s.name === 'Forager').length)
      + (2 * active.retinue.filter((s) => s.name === 'Cook').length);
    const discount = specialistDiscount - eventCostDelta;

    const selectedCards = contracts.filter((c) => selectedIds.includes(c.id));
    const campaignCost = contractCost(selectedCards, discount);
    const canAfford = active.money >= campaignCost;
    const hasSelected = selectedCards.length > 0;
    const req = selectedCards.reduce(
      (sum, c) => {
        sum.melee += c.requirements.melee;
        sum.ranged += c.requirements.ranged;
        sum.mounted += c.requirements.mounted;
        return sum;
      },
      { melee: 0, ranged: 0, mounted: 0 },
    );
    const canMeetTroops = (
      active.troops.melee >= req.melee
      && active.troops.ranged >= req.ranged
      && active.troops.mounted >= req.mounted
    );

    const shortage = {
      melee: Math.max(0, req.melee - active.troops.melee),
      ranged: Math.max(0, req.ranged - active.troops.ranged),
      mounted: Math.max(0, req.mounted - active.troops.mounted),
    };

    let troopMsg = '';
    if (hasSelected) {
      const reqText = `Required troops: M${req.melee}/R${req.ranged}/Mo${req.mounted}`;
      const haveText = `You have: M${active.troops.melee}/R${active.troops.ranged}/Mo${active.troops.mounted}`;
      if (canMeetTroops) {
        troopMsg = `<p class="meta">${reqText}. ${haveText}. <span class="win">✓ Troops available</span></p>`;
      } else {
        const missingParts = [];
        if (shortage.melee > 0) missingParts.push(`M${shortage.melee}`);
        if (shortage.ranged > 0) missingParts.push(`R${shortage.ranged}`);
        if (shortage.mounted > 0) missingParts.push(`Mo${shortage.mounted}`);
        troopMsg = `<p class="meta">${reqText}. ${haveText}. <span class="fail">✗ Missing ${missingParts.join(', ')}</span></p>`;
      }
    }

    let costMsg = '';
    if (!hasSelected) {
      costMsg = '<p class="meta">No contracts selected — running with zero will skip campaign.</p>';
    } else if (selectedCards.length === 1) {
      costMsg = '<p class="meta">Campaign cost: <strong>free</strong> (single contract).</p>';
    } else {
      const regions = selectedCards.map((c) => c.region);
      const crossRegion = regions.some((r, i) => i > 0 && r !== regions[i - 1]);
      costMsg = `<p class="meta">Campaign cost: <strong>${campaignCost} coin${campaignCost !== 1 ? 's' : ''}</strong>
        (${selectedCards.length} contracts${crossRegion ? ', cross-region +3' : ''}${discount > 0 ? `, discount -${discount}` : discount < 0 ? `, surcharge +${-discount}` : ''}).
        You have <strong>${active.money}</strong> coin${active.money !== 1 ? 's' : ''}.
        ${canAfford ? '<span class="win">✓ Affordable</span>' : '<span class="fail">✗ Cannot afford</span>'}
      </p>`;
    }

    const contractButtons = contracts
      .map(
        (card) => `
          <button class="action ${selectedIds.includes(card.id) ? 'selected' : ''}" data-action="toggle-contract" data-id="${card.id}">
            ${contractText(card)}
          </button>
        `,
      )
      .join('');

    const runDisabled = hasSelected && (!canAfford || !canMeetTroops) ? 'disabled' : '';
    const runLabel = hasSelected ? `Run Campaign (cost: ${campaignCost === 0 ? 'free' : campaignCost + ' coins'})` : 'Skip Campaign (no cost)';
    const canUndo = (game.undoStack || []).length > 0;

    return `
      <section class="panel">
        <h3>Human Campaign</h3>
        <p>Select up to 3 contracts. You may run with zero to skip.</p>
        ${costMsg}
        ${troopMsg}
        <div class="contracts-list">${contractButtons || '<p>No contracts in hand.</p>'}</div>
        <button class="primary" data-action="run-campaign" ${runDisabled}>${runLabel}</button>
        <button class="action undo-btn" data-action="undo" ${canUndo ? '' : 'disabled'}>↩ Undo</button>
      </section>
    `;
  }

  if (game.humanState.step === 'battle') {
    const pb = game.humanState.pendingBattle;
    const { currentContract, rolls, contractQueue, sacrificed } = pb;
    const preview = previewBattleOutcome(active, currentContract, rolls, sacrificed);
    const outcomeLabel = preview.willSucceed
      ? '<span class="win">✓ Will SUCCEED</span>'
      : '<span class="fail">✗ Will FAIL</span>';
    const diceRows = ['melee', 'ranged', 'mounted'].map((type) => {
      if (rolls[type].length === 0) return '';
      const dice = rolls[type].map((roll, i) => {
        let cls = 'die-dead';
        if (roll === 3) cls = 'die-wounded';
        else if (roll === 6) cls = 'die-wild';
        else if (roll >= 4) cls = 'die-success';
        const isSac = sacrificed[type].includes(i);
        const isEligible = roll === 3 || (roll >= 4 && roll <= 6);
        const sacBtn = isEligible
          ? `<span class="die-btn${isSac ? ' sac-active' : ''}" data-action="sacrifice-die" data-type="${type}" data-index="${i}" title="${isSac ? 'Undo sacrifice' : 'Sacrifice this unit for +1 typed success; a 6 keeps its wild success'}">⚔</span>`
          : '';
        return `<span class="die-entry"><span class="die ${cls}${isSac ? ' die-sacrificed' : ''}">${roll}</span>${sacBtn}<span class="die-btn reroll-btn" data-action="reroll-die" data-type="${type}" data-index="${i}" title="Reroll (costs 1 equipment)">↩</span></span>`;
      }).join('');
      return `<div><strong>${type.charAt(0).toUpperCase() + type.slice(1)}:</strong> ${dice}</div>`;
    }).join('');
    const deadSummary = `M${preview.dead.melee}/R${preview.dead.ranged}/Mo${preview.dead.mounted}`;
    const woundSummary = `M${preview.wounded.melee}/R${preview.wounded.ranged}/Mo${preview.wounded.mounted}`;
    const canUndo = (game.undoStack || []).length > 0;
    return `
      <section class="panel">
        <h3>Battle: ${currentContract.title}</h3>
        <p>Requires: M${currentContract.requirements.melee} / R${currentContract.requirements.ranged} / Mo${currentContract.requirements.mounted} — ${currentContract.type.toUpperCase()} [${currentContract.region}]</p>
        <p>${outcomeLabel}${preview.willSucceed ? ` (${currentContract.renown} renown, ${currentContract.coins} coins)` : ''}</p>
        <div class="dice-grid">${diceRows}</div>
        <p class="meta">Dead: ${deadSummary} | Wounded: ${woundSummary}</p>
        <p class="meta">Equipment: ${active.equipment} | ⚔ = sacrifice a wounded, successful, or wild unit for +1 typed success (6s keep their wild success) | ↩ = reroll (1 equipment)</p>
        <button class="primary" data-action="confirm-battle">Confirm Result</button>
        <button class="action undo-btn" data-action="undo" ${canUndo ? '' : 'disabled'}>↩ Undo (back to campaign)</button>
        ${contractQueue.length > 0 ? `<p class="meta">${contractQueue.length} more contract(s) queued after this.</p>` : ''}
      </section>
    `;
  }

  if (game.humanState.step === 'draw') {
    const offerDisabled = (tier) => (game.offer[tier].length === 0 ? 'disabled' : '');
    const deckDisabled = (tier) => ((game.tierDecks[tier] || []).length === 0 ? 'disabled' : '');
    const canUndo = (game.undoStack || []).length > 0;
    return `
      <section class="panel">
        <h3>Muster Draw (${game.humanState.drawChoicesRemaining} left)</h3>
        <div class="actions-grid">
          <button class="action" data-action="draw" data-source="offer:A" ${offerDisabled('A')}>Take Tier A Offer</button>
          <button class="action" data-action="draw" data-source="offer:B" ${offerDisabled('B')}>Take Tier B Offer</button>
          <button class="action" data-action="draw" data-source="offer:C" ${offerDisabled('C')}>Take Tier C Offer</button>
          <button class="action" data-action="draw" data-source="deck:A" ${deckDisabled('A')}>Draw Tier A Deck</button>
          <button class="action" data-action="draw" data-source="deck:B" ${deckDisabled('B')}>Draw Tier B Deck</button>
          <button class="action" data-action="draw" data-source="deck:C" ${deckDisabled('C')}>Draw Tier C Deck</button>
        </div>
        <button class="action undo-btn" data-action="undo" ${canUndo ? '' : 'disabled'}>↩ Undo last draw</button>
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
  const tierCount = (tier, kind) =>
    (game.tierDecks?.[tier] || []).filter((card) => card.kind === kind).length;
  const totalContracts = tierCount('A', 'contract') + tierCount('B', 'contract') + tierCount('C', 'contract');
  const totalSpecialists = tierCount('A', 'specialist') + tierCount('B', 'specialist') + tierCount('C', 'specialist');
  const totalEvents = tierCount('A', 'event') + tierCount('B', 'event') + tierCount('C', 'event');

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
      if (action === 'reroll-die') humanRerollDie(game, type, Number(button.dataset.index));
      if (action === 'sacrifice-die') humanToggleSacrifice(game, type, Number(button.dataset.index));
      if (action === 'confirm-battle') humanConfirmBattle(game);
      if (action === 'draw') humanDrawCard(game, source);
      if (action === 'undo') humanUndo(game);

      if (!game.isFinished && game.mode === 'interactive' && action !== 'undo' && !getActivePlayer(game).isHuman) {
        autoPlayUntilHumanOrEnd(game);
      }

      renderGame();
    });
  });
}

renderStartScreen();
