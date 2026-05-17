const CHUNK_SIZE = 20; // simulations per async tick

export function renderProgressScreen(app, done, total) {
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

export function runBatchWithProgress(app, config, total, runMultiple, ruleset, onComplete) {
  const batchResults = [];
  renderProgressScreen(app, 0, total);

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
      renderProgressScreen(app, batchResults.length, total);
      setTimeout(runChunk, 0);
    } else {
      onComplete(batchResults, ruleset);
    }
  }

  setTimeout(runChunk, 0);
}

export function renderBatchResults(app, batchResults, batchRuleset, labelForRuleset, renderStartScreenFn) {
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
    renderStartScreenFn();
  });
}
