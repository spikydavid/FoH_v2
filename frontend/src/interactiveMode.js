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
} from './gameEngine';

export function renderHumanControls(game, uiEconomyForGame) {
  const active = getActivePlayer(game);
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
        <h3>Market Phase</h3>
        <div class="actions-grid">
          <button class="action" data-action="buy-market" data-type="melee" ${active.coins < recruitCosts.melee ? 'disabled' : ''}>Buy Melee Troop (${recruitCosts.melee} coins)</button>
          <button class="action" data-action="buy-market" data-type="ranged" ${active.coins < recruitCosts.ranged ? 'disabled' : ''}>Buy Ranged Troop (${recruitCosts.ranged} coins)</button>
          <button class="action" data-action="buy-market" data-type="mounted" ${active.coins < recruitCosts.mounted ? 'disabled' : ''}>Buy Mounted Troop (${recruitCosts.mounted} coins)</button>
          <button class="action" data-action="buy-eq" ${active.coins < economy.equipmentCost ? 'disabled' : ''}>Buy Equipment (${economy.equipmentCost} coins)</button>
          ${active.coins >= 2 && availableToHire.length > 0 ? `<button class="action" data-action="loan">Hire Specialist</button>` : ''}
          ${active.debt < active.renown ? `<button class="action" data-action="loan">Take Loan (10 coins, +1 debt)</button>` : ''}
        </div>
        <button class="primary" data-action="to-campaign">Proceed to Campaign</button>
      </section>
    `;
  }

  if (game.humanState.step === 'campaign') {
    const selectedCount = selectedIds.length;
    const preview = null;

    const contractRows = contracts.map((card) => {
      const isSelected = selectedIds.includes(card.cardNumber);
      const btnClass = isSelected ? 'action-selected' : '';
      return `
        <div class="action-card">
          <input type="checkbox" class="contract-select" data-id="${card.cardNumber}" ${isSelected ? 'checked' : ''} />
          <h4>${card.title}</h4>
          <p class="meta">#${card.cardNumber}, ${card.tier}, ${card.type.toUpperCase()}</p>
          <p class="meta">Req: M${card.requirements.melee} / R${card.requirements.ranged} / Mo${card.requirements.mounted} → ${card.renown} renown, ${card.coins} coins</p>
        </div>
      `;
    });

    const selectedList = selectedIds
      .map((id) => contracts.find((c) => c.cardNumber === id)?.title || `Unknown #${id}`)
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
