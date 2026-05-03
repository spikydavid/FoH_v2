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
  previewBattleOutcome,
  runSimulation,
  runMultipleSimulations,
  scoreTable,
} from './gameEngine';
import { CONTRACT_DATA_SYNC } from './contractsData';
import { SPECIALIST_DATA_SYNC } from './specialistsData';

const app = document.querySelector('#app');
let game = null;
let batchResults = null;

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
  const tierA = game.offer.A.map((c) => `<div class="chip">${offerCardText(c)}</div>`).join('') || '<em>None</em>';
  const tierB = game.offer.B.map((c) => `<div class="chip">${offerCardText(c)}</div>`).join('') || '<em>None</em>';
  const tierC = game.offer.C.map((c) => `<div class="chip">${offerCardText(c)}</div>`).join('') || '<em>None</em>';
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
          <button id="start-sim">Simulation Mode (AI only)</button>
          <button id="start-int">Interactive Mode (humans + AI)</button>
          <button id="start-batch">Batch Simulation</button>
        </div>
        <form id="config-form">
          <label>Players (2-4)
            <input id="player-count" type="number" min="2" max="4" value="4" />
          </label>
          <label>Human players (0-4)
            <input id="human-count" type="number" min="0" max="4" value="1" />
          </label>
          <label>Batch runs
            <input id="batch-count" type="number" min="1" max="1000" value="100" />
          </label>
        </form>
      </section>
    </main>
  `;

  const playersInput = document.querySelector('#player-count');
  const humansInput = document.querySelector('#human-count');

  document.querySelector('#start-sim').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    try {
      game = createGame({ mode: 'simulation', playerCount, humanPlayers: 0 });
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
    game = createGame({ mode: 'interactive', playerCount, humanPlayers });
    autoPlayUntilHumanOrEnd(game);
    renderGame();
  });

  document.querySelector('#start-batch').addEventListener('click', () => {
    const playerCount = Math.max(2, Math.min(4, Number(playersInput.value) || 4));
    const batchCount = Math.max(1, Math.min(1000, Number(document.querySelector('#batch-count').value) || 100));
    runBatchWithProgress({ playerCount }, batchCount);
  });

  async function doSync(endpoint, btnId, statusId) {
    const btn = document.querySelector(`#${btnId}`);
    const status = document.querySelector(`#${statusId}`);
    btn.disabled = true;
    btn.textContent = '⏳ Syncing…';
    status.textContent = '';
    status.className = 'sync-status';
    try {
      const res = await fetch(`http://localhost:3000/api/${endpoint}`, { method: 'POST' });
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

function runBatchWithProgress(config, total) {
  batchResults = [];
  renderProgressScreen(0, total);

  function runChunk() {
    const chunkEnd = Math.min(batchResults.length + CHUNK_SIZE, total);
    try {
      const chunk = runMultipleSimulations(config, chunkEnd - batchResults.length);
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

  // Per-player win count and aggregate score components
  const playerStats = {};
  for (const name of playerNames) {
    playerStats[name] = {
      wins: 0,
      totalScore: 0,
      totalContracts: 0,
      totalContractRenown: 0,
      totalSetBonus: 0,
      totalHuntBonus: 0,
      totalDebtPenalty: 0,
      totalTierA: 0,
      totalTierB: 0,
      totalTierC: 0,
      totalTierR: 0,
      totalMoney: 0,
    };
  }
  for (const result of results) {
    const winner = result.ranking[0];
    playerStats[winner.name].wins += 1;
    for (const entry of result.ranking) {
      const s = playerStats[entry.name];
      s.totalScore += entry.score.total;
      s.totalContracts += entry.score.contracts;
      s.totalContractRenown += entry.score.contractRenown;
      s.totalSetBonus += entry.score.setBonus;
      s.totalHuntBonus += (entry.score.huntBonus || 0);
      s.totalDebtPenalty += entry.score.debtPenalty;
      s.totalTierA += (entry.score.tierCounts?.A || 0);
      s.totalTierB += (entry.score.tierCounts?.B || 0);
      s.totalTierC += (entry.score.tierCounts?.C || 0);
      s.totalTierR += (entry.score.tierCounts?.R || 0);
      s.totalMoney += entry.score.money;
    }
  }

  const avg = (total) => (total / n).toFixed(1);
  const pct = (wins) => ((wins / n) * 100).toFixed(1);
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

  // Summary table
  const summaryRows = playerNames.map((name) => {
    const s = playerStats[name];
    return `<tr>
      <td>${name}</td>
      <td><strong>${s.wins}</strong> (${pct(s.wins)}%)</td>
      <td>${avg(s.totalScore)}</td>
      <td>${avg(s.totalContracts)}</td>
      <td>${avg(s.totalContractRenown)}</td>
      <td>${avg(s.totalSetBonus)}</td>
      <td>${avg(s.totalHuntBonus)}</td>
      <td>-${avg(s.totalDebtPenalty)}</td>
      <td>${avg(s.totalTierA)}</td>
      <td>${avg(s.totalTierB)}</td>
      <td>${avg(s.totalTierC)}</td>
      <td>${avg(s.totalTierR)}</td>
      <td>${avg(s.totalMoney)}</td>
    </tr>`;
  }).join('');

  // Per-game results table (most recent 200 shown if large batch)
  const shown = results.slice(0, 200);
  const gameRows = shown.map((result) => {
    const cells = result.ranking.map((entry, idx) => {
      const medal = idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : '';
      const s = entry.score;
      const tiers = s.tierCounts || { A: 0, B: 0, C: 0, R: 0 };
      return `<td class="${idx === 0 ? 'batch-winner' : ''}">
        ${medal}<strong>${entry.name}</strong><br>
        <span class="meta">Total: ${s.total} | Contracts: ${s.contracts} (A${tiers.A}/B${tiers.B}/C${tiers.C}/R${tiers.R}) | Renown: ${s.contractRenown} | Sets: ${s.setBonus}${s.huntBonus ? ` | Hunt: ${s.huntBonus}` : ''} | Debt: -${s.debtPenalty} | Coins: ${s.money}</span>
      </td>`;
    }).join('');
    return `<tr><td class="meta">#${result.gameIndex} (${result.rounds}r)</td>${cells}</tr>`;
  }).join('');

  const placeHeaders = results[0].ranking.map((_, i) => `<th>${i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`}</th>`).join('');

  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <h2>Batch Simulation Results (${n} games)</h2>
        <button id="batch-back">← Back to Start</button>

        <h3>Summary</h3>
        <table>
          <thead><tr><th>Player</th><th>Wins</th><th>Avg Score</th><th>Avg Contracts</th><th>Avg Renown</th><th>Avg Sets</th><th>Avg Hunt</th><th>Avg Debt</th><th>Avg Tier A</th><th>Avg Tier B</th><th>Avg Tier C</th><th>Avg Tier R</th><th>Avg Coins</th></tr></thead>
          <tbody>${summaryRows}</tbody>
        </table>

        <h3>Win Rate Chart</h3>
        <div class="batch-bars">
          ${chartPlayerNames.map((name) => {
            const winPct = (playerStats[name].wins / n) * 100;
            return `<div class="batch-bar-row">
              <span class="batch-bar-label">${name}</span>
              <div class="batch-bar-track">
                <div class="batch-bar-fill" style="width:${winPct.toFixed(1)}%"></div>
              </div>
              <span class="batch-bar-pct">${winPct.toFixed(1)}%</span>
            </div>`;
          }).join('')}
        </div>

        <h3>Per-Game Results ${n > 200 ? `(first 200 of ${n} shown)` : ''}</h3>
        <div class="batch-table-scroll">
          <table>
            <thead><tr><th>Game</th>${placeHeaders}</tr></thead>
            <tbody>${gameRows}</tbody>
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
    const eventCostDelta = active.eventInPlay?.ongoing?.campaignCostDelta || 0;
    const specialistDiscount = (active.retinue.filter((s) => s.name === 'Forager').length)
      + (2 * active.retinue.filter((s) => s.name === 'Cook').length);
    const discount = specialistDiscount - eventCostDelta;

    const selectedCards = contracts.filter((c) => selectedIds.includes(c.id));
    const campaignCost = contractCost(selectedCards, discount);
    const canAfford = active.money >= campaignCost;
    const hasSelected = selectedCards.length > 0;

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

    const runDisabled = hasSelected && !canAfford ? 'disabled' : '';
    const runLabel = hasSelected ? `Run Campaign (cost: ${campaignCost === 0 ? 'free' : campaignCost + ' coins'})` : 'Skip Campaign (no cost)';

    return `
      <section class="panel">
        <h3>Human Campaign</h3>
        <p>Select up to 3 contracts. You may run with zero to skip.</p>
        ${costMsg}
        <div class="contracts-list">${contractButtons || '<p>No contracts in hand.</p>'}</div>
        <button class="primary" data-action="run-campaign" ${runDisabled}>${runLabel}</button>
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
    return `
      <section class="panel">
        <h3>Battle: ${currentContract.title}</h3>
        <p>Requires: M${currentContract.requirements.melee} / R${currentContract.requirements.ranged} / Mo${currentContract.requirements.mounted} — ${currentContract.type.toUpperCase()} [${currentContract.region}]</p>
        <p>${outcomeLabel}${preview.willSucceed ? ` (${currentContract.renown} renown, ${currentContract.coins} coins)` : ''}</p>
        <div class="dice-grid">${diceRows}</div>
        <p class="meta">Dead: ${deadSummary} | Wounded: ${woundSummary}</p>
        <p class="meta">Equipment: ${active.equipment} | ⚔ = sacrifice a wounded, successful, or wild unit for +1 typed success (6s keep their wild success) | ↩ = reroll (1 equipment)</p>
        <button class="primary" data-action="confirm-battle">Confirm Result</button>
        ${contractQueue.length > 0 ? `<p class="meta">${contractQueue.length} more contract(s) queued after this.</p>` : ''}
      </section>
    `;
  }

  if (game.humanState.step === 'draw') {
    const offerDisabled = (tier) => (game.offer[tier].length === 0 ? 'disabled' : '');
    const deckDisabled = (tier) => ((game.tierDecks[tier] || []).length === 0 ? 'disabled' : '');
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
          <p>Tier A deck: C${tierCount('A', 'contract')} / S${tierCount('A', 'specialist')} / E${tierCount('A', 'event')}</p>
          <p>Tier B deck: C${tierCount('B', 'contract')} / S${tierCount('B', 'specialist')} / E${tierCount('B', 'event')}</p>
          <p>Tier C deck: C${tierCount('C', 'contract')} / S${tierCount('C', 'specialist')} / E${tierCount('C', 'event')}</p>
          <p>Main decks total: C${totalContracts} / S${totalSpecialists} / E${totalEvents}</p>
          <p>Rewards deck (Tier R contracts): ${game.rewardsDeck.length}</p>
          ${renderOffer()}
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

      if (!game.isFinished && game.mode === 'interactive' && !getActivePlayer(game).isHuman) {
        autoPlayUntilHumanOrEnd(game);
      }

      renderGame();
    });
  });
}

renderStartScreen();
