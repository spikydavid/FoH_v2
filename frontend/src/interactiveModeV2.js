import {
  getActivePlayer,
  humanBuyEquipment,
  humanBuyTroop,
  humanConfirmBattle,
  humanDischargeSpecialist,
  humanDrawCard,
  humanHireSpecialist,
  humanProceedToCampaign,
  humanRerollDie,
  humanRunCampaign,
  humanTakeLoan,
  humanToggleContractSelection,
  humanToggleSacrifice,
  humanUndo,
  autoPlayUntilHumanOrEnd,
  previewBattleOutcome,
  scoreTable,
  humanSelectV2Lot,
  humanV2DraftContract,
  humanV2SkipDraftContracts,
  humanV2RecruitSpecialist,
  humanV2SkipRecruitSpecialists,
  humanV2PurchaseEquipment,
  humanV2DonePurchasingEquipment,
  economyRulesForGame,
} from './gameEngineV2';

export function renderHumanControls(game, uiEconomyForGame) {
  const active = getActivePlayer(game);
  const economy = uiEconomyForGame(game);
  const marketCosts = economy.troopCosts.market;
  const supplyCosts = economy.troopCosts.supply;
  const specialistSurcharge = economy.specialistHireSurcharge;

  const specialistCards = active.hand.filter((card) => card.kind === 'specialist');
  const contracts = active.hand.filter((card) => card.kind === 'contract');
  const selectedIds = game.humanState.selectedContractIds || [];

  // V2 Lot Selection Phase
  if (game.humanState.step === 'v2-lot-selection' && game.v2Lots) {
    const lots = game.v2Lots;
    const currentPlayer = game.players[game.v2CurrentLotSelectionPlayerIndex];
    
    return `
      <section class="panel">
        <h3>V2 Lot Selection</h3>
        <p class="meta">${currentPlayer.name} is selecting from ${lots.length} available lot(s)</p>
        <div class="lot-selection-grid">
          ${lots.map((lot, idx) => `
            <button class="lot-card" data-action="select-lot" data-index="${idx}">
              <div class="lot-card-title">Lot ${idx + 1}</div>
              <div class="lot-stats">
                <div class="lot-stat">Melee: ${lot.melee}</div>
                <div class="lot-stat">Ranged: ${lot.ranged}</div>
                <div class="lot-stat">Mounted: ${lot.mounted}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }

  if (game.humanState.step === 'market') {
    const specialistRulesText = (card) => (card.effect || 'No specialist rule text available.')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const hired = active.specialistsInPlay || [];
    const availableToHire = specialistCards.filter(
      (card) => !hired.find((s) => s.cardNumber === card.cardNumber),
    );

    if (game.humanState.marketAction === 'hire-specialist') {
      return `
        <section class="panel">
          <h3>Hire Specialist</h3>
          <div class="actions-grid">
            ${availableToHire.map((card) => {
              const cost = 2 + specialistSurcharge;
              const canAfford = active.coins >= cost;
              return `
                <div class="action-card">
                  <h4>${card.title}</h4>
                  <p class="meta">Cost: ${cost} coins</p>
                  <p style="font-size: 12px; margin: 8px 0;">${specialistRulesText(card)}</p>
                  <button class="action" data-action="hire" data-id="${card.cardNumber}" ${!canAfford ? 'disabled' : ''}>
                    ${canAfford ? 'Hire' : `Not enough coins (need ${cost}, have ${active.coins})`}
                  </button>
                </div>
              `;
            }).join('') || '<p class="meta">No specialists available to hire.</p>'}
          </div>
          <button class="action" data-action="to-campaign">Done Hiring</button>
        </section>
      `;
    }

    const recruitCosts = Object.fromEntries(
      Object.entries(marketCosts).map(([type, cost]) => [type, cost]),
    );

    return `
      <section class="panel">
        <h3>Market Phase (V2)</h3>
        <p class="meta">In V2, the market uses a lot system. Lots (sets of 3 dice) were created and players selected them in turn order.</p>
        <div class="v2-market-summary">
          <p><strong>Your current troops:</strong></p>
          <p>Melee: ${active.troops.melee} | Ranged: ${active.troops.ranged} | Mounted: ${active.troops.mounted}</p>
        </div>
        <div class="actions-grid">
          <button class="action" data-action="buy-eq" ${active.coins < economy.equipmentCost ? 'disabled' : ''}>Buy Equipment (${economy.equipmentCost} coins)</button>
          ${active.coins >= 2 && availableToHire.length > 0 ? `<button class="action" data-action="hire-specialist">Hire Specialist</button>` : ''}
          ${active.debt < active.renown ? `<button class="action" data-action="loan">Take Loan (${economy.loanAmount} coins, +1 debt)</button>` : ''}
        </div>
        <button class="primary" data-action="to-campaign">Proceed to Campaign</button>
      </section>
    `;
  }

  if (game.humanState.step === 'campaign') {
    const selectedCount = selectedIds.length;
    const preview = null;

    const contractRows = contracts.map((card) => {
      const isSelected = selectedIds.includes(card.id);
      const btnClass = isSelected ? 'action-selected' : '';
      return `
        <div class="action-card">
          <input type="checkbox" class="contract-select" data-id="${card.id}" ${isSelected ? 'checked' : ''} />
          <h4>${card.title}</h4>
          <p class="meta">#${card.cardNumber}, ${card.tier}, ${card.type.toUpperCase()}</p>
          <p class="meta">Req: M${card.requirements.melee} / R${card.requirements.ranged} / Mo${card.requirements.mounted} → ${card.renown} renown, ${card.coins} coins</p>
        </div>
      `;
    });

    const selectedList = selectedIds
      .map((id) => contracts.find((c) => c.id === id)?.title || `Unknown #${id}`)
      .join(', ');

    return `
      <section class="panel">
        <h3>Campaign Phase</h3>
        <p>${selectedCount === 0 ? 'Select contracts to attack:' : `Selected (${selectedCount}): ${selectedList}`}</p>
        <div class="actions-grid">
          ${contractRows.join('')}
        </div>
        ${preview ? `
          <div class="preview">
            <h4>Battle Preview</h4>
            <p>${preview.message}</p>
          </div>
        ` : ''}
        <button class="primary" data-action="run-campaign" ${selectedCount === 0 ? 'disabled' : ''}>Run Campaign</button>
      </section>
    `;
  }

  if (game.humanState.step === 'battle') {
    const pb = game.humanState.pendingBattle;
    if (!pb) {
      return `<section class="panel"><p>Loading battle...</p></section>`;
    }

    const currentContract = pb.currentContract;
    const contractQueue = pb.contractQueue || [];
    const canUndo = (game.undoStack || []).length > 0;

    const rerollRows = ['melee', 'ranged', 'mounted']
      .filter((type) => pb.rolls[type] && pb.rolls[type].length > 0)
      .map((type) => {
        const typedRolls = pb.rolls[type];
        return `
          <div>
            <p style="font-weight: bold; margin-bottom: 8px;">${type.charAt(0).toUpperCase() + type.slice(1)} (${typedRolls.length})</p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${typedRolls.map((rollValue, idx) => {
                const isSacrifice = (pb.sacrificed[type] || []).includes(idx);
                const isWild = rollValue === 6 || rollValue === 1;
                const sacTitle = isWild ? '♦ Wild (use for equipment reroll only)' : 'Mark for sacrifice';
                return `
                  <div class="die-group">
                    <button class="die-btn" data-action="reroll-die" data-type="${type}" data-index="${idx}">${rollValue}</button>
                    ${isSacrifice || !isWild ? `<button class="die-btn sac-btn" data-action="sacrifice-die" data-type="${type}" data-index="${idx}" title="${sacTitle}">💔</button>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <section class="panel">
        <h3>Battle: ${currentContract.title}</h3>
        <p class="meta">Req: M${currentContract.requirements.melee} / R${currentContract.requirements.ranged} / Mo${currentContract.requirements.mounted}</p>
        <p>Roll results:</p>
        <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
          ${rerollRows || '<p>Rolling dice...</p>'}
        </div>
        <p class="meta">Equipment: ${active.equipment} | ⚔ = sacrifice a wounded, successful, or wild unit for +1 typed success (6s keep their wild success) | ↩ = reroll (1 equipment)</p>
        <button class="primary" data-action="confirm-battle">Confirm Result</button>
        <button class="action undo-btn" data-action="undo" ${canUndo ? '' : 'disabled'}>↩ Undo (back to campaign)</button>
        ${contractQueue.length > 0 ? `<p class="meta">${contractQueue.length} more contract(s) queued after this.</p>` : ''}
      </section>
    `;
  }

  if (game.humanState.step === 'v2-draft-contracts') {
    const poolA = game.v2DraftPool?.A || [];
    const poolB = game.v2DraftPool?.B || [];
    const poolC = game.v2DraftPool?.C || [];
    const cardsNeeded = Math.max(0, 5 - active.hand.length);
    return `
      <section class="panel">
        <h3>Draft Contracts</h3>
        <p class="meta">Pool: A${poolA.length} / B${poolB.length} / C${poolC.length} | Your hand: ${active.hand.length}/5</p>
        <p class="meta">Pick one contract, or skip to let others draft.</p>
        <div class="actions-grid">
          <button class="action" data-action="v2-draft" data-tier="A" ${poolA.length === 0 ? 'disabled' : ''}>Take Tier A ${poolA.length > 0 ? `(${poolA[0].title})` : '(empty)'}</button>
          <button class="action" data-action="v2-draft" data-tier="B" ${poolB.length === 0 ? 'disabled' : ''}>Take Tier B ${poolB.length > 0 ? `(${poolB[0].title})` : '(empty)'}</button>
          <button class="action" data-action="v2-draft" data-tier="C" ${poolC.length === 0 ? 'disabled' : ''}>Take Tier C ${poolC.length > 0 ? `(${poolC[0].title})` : '(empty)'}</button>
        </div>
        <button class="primary" data-action="v2-skip-draft">Skip</button>
      </section>
    `;
  }

  if (game.humanState.step === 'v2-recruit-specialists') {
    const recruitIdx = game.v2RecruitPendingPlayerIndex;
    const recruitPlayer = recruitIdx !== undefined && recruitIdx !== null ? game.players[recruitIdx] : active;
    const specialistCards = game.v2SpecialistMarket || [];
    const retinueSize = (recruitPlayer.retinue || []).length;
    const cost = 2 + retinueSize;
    const canHire = retinueSize < 3 && specialistCards.length > 0 && recruitPlayer.money >= cost;
    return `
      <section class="panel">
        <h3>Recruit Specialists</h3>
        <p class="meta">${recruitPlayer.name} is recruiting from the specialist market (cost: ${cost} coins), or may pass.</p>
        <p class="meta">Market cards: ${specialistCards.length}</p>
        <div class="actions-grid">
          ${specialistCards.map((card) => `
            <div class="action-card">
              <h4>${card.title}</h4>
              <p style="font-size:12px;margin:4px 0">${(card.effect || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
              <button class="action" data-action="v2-recruit" data-id="${card.id}" ${!canHire ? 'disabled' : ''}>
                ${recruitPlayer.money >= cost ? `Hire (${cost} coins)` : `Need ${cost} coins (have ${recruitPlayer.money})`}
              </button>
            </div>
          `).join('') || '<p class="meta">No specialists available in the market.</p>'}
        </div>
        <button class="primary" data-action="v2-skip-recruit">Pass</button>
      </section>
    `;
  }

  if (game.humanState.step === 'v2-purchase-equipment') {
    const pendingIdx = game.v2EquipmentPendingPlayerIndex;
    const purchasePlayer = pendingIdx !== undefined && pendingIdx !== null ? game.players[pendingIdx] : active;
    const eqCost = economyRulesForGame(game).equipmentCost;
    const market = game.v2EquipmentMarket || 0;
    const canBuy = purchasePlayer.money >= eqCost && market > 0;
    return `
      <section class="panel">
        <h3>Purchase Equipment</h3>
        <p class="meta">${purchasePlayer.name} may buy any amount or pass.</p>
        <p class="meta">Coins: ${purchasePlayer.money} | Equipment: ${purchasePlayer.equipment} | Market: ${market}</p>
        <div class="actions-grid">
          <button class="action" data-action="v2-buy-eq" ${!canBuy ? 'disabled' : ''}>Buy Equipment (${eqCost} coins)</button>
        </div>
        <button class="primary" data-action="v2-done-eq">Pass</button>
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

export function setupInteractiveEventListeners(game, renderGameFn) {
  const app = document.querySelector('#app');

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
      if (action === 'hire-specialist') game.humanState.marketAction = 'hire-specialist';
      if (action === 'hire') humanHireSpecialist(game, id);
      if (action === 'fire') humanDischargeSpecialist(game, id);
      if (action === 'to-campaign') humanProceedToCampaign(game);
      if (action === 'toggle-contract') humanToggleContractSelection(game, id);
      if (action === 'run-campaign') humanRunCampaign(game);
      if (action === 'select-lot') humanSelectV2Lot(game, Number(button.dataset.index));
      if (action === 'v2-draft') humanV2DraftContract(game, button.dataset.tier);
      if (action === 'v2-skip-draft') humanV2SkipDraftContracts(game);
      if (action === 'v2-recruit') humanV2RecruitSpecialist(game, id);
      if (action === 'v2-skip-recruit') humanV2SkipRecruitSpecialists(game);
      if (action === 'v2-buy-eq') humanV2PurchaseEquipment(game);
      if (action === 'v2-done-eq') humanV2DonePurchasingEquipment(game);
      if (action === 'reroll-die') humanRerollDie(game, type, Number(button.dataset.index));
      if (action === 'sacrifice-die') humanToggleSacrifice(game, type, Number(button.dataset.index));
      if (action === 'confirm-battle') humanConfirmBattle(game);
      if (action === 'draw') humanDrawCard(game, source);
      if (action === 'undo') humanUndo(game);

      const v2LotOrPostCampaignActions = ['select-lot', 'v2-draft', 'v2-skip-draft', 'v2-recruit', 'v2-skip-recruit', 'v2-buy-eq', 'v2-done-eq'];
      if (!game.isFinished && game.mode === 'interactive' && v2LotOrPostCampaignActions.includes(action)) {
        autoPlayUntilHumanOrEnd(game);
      }

      if (!game.isFinished && game.mode === 'interactive' && action !== 'undo' && !v2LotOrPostCampaignActions.includes(action) && !getActivePlayer(game).isHuman) {
        autoPlayUntilHumanOrEnd(game);
      }

      renderGameFn();
    });
  });

  // Handle contract selection checkboxes
  app.querySelectorAll('.contract-select').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const id = checkbox.dataset.id;
      if (checkbox.checked) {
        humanToggleContractSelection(game, id);
      } else {
        humanToggleContractSelection(game, id);
      }
      renderGameFn();
    });
  });
}
