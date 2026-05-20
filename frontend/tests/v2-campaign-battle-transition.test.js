import { describe, it, expect } from 'vitest';

import {
  autoPlayUntilHumanOrEnd,
  createGameV2,
  getActivePlayer,
  humanRunCampaign,
  humanSelectV2Lot,
  humanToggleContractSelection,
} from '../src/gameEngineV2.js';
import { renderHumanControls } from '../src/interactiveModeV2.js';

function uiEconomyForGame() {
  return {
    troopCosts: {
      market: { melee: 3, ranged: 4, mounted: 5 },
      supply: { melee: 5, ranged: 7, mounted: 9 },
    },
    equipmentCost: 2,
    specialistHireSurcharge: 1,
    loanAmount: 6,
  };
}

function advanceThroughLotSelection(game) {
  autoPlayUntilHumanOrEnd(game);
  let guard = 20;
  while (guard-- > 0 && game.humanState?.step === 'v2-lot-selection' && (game.v2Lots || []).length > 0) {
    const ok = humanSelectV2Lot(game, 0);
    expect(ok).toBe(true);
    autoPlayUntilHumanOrEnd(game);
  }
}

describe('V2 campaign to battle transition', () => {
  it('renders battle panel after Run Campaign using selected contract ids', () => {
    const game = createGameV2({ mode: 'interactive', playerCount: 4, humanPlayers: 1, disableEvents: true });

    // V2 has two early lot selection moments for the human: pre-game and first-turn market.
    advanceThroughLotSelection(game);

    expect(game.humanState.step).toBe('campaign');

    const player = getActivePlayer(game);
    const firstContract = (player.hand || []).find((card) => card.kind === 'contract');
    expect(firstContract).toBeTruthy();

    // Make the campaign deterministic for the regression: always affordable and eligible.
    player.money = 999;
    player.troops = { melee: 10, ranged: 10, mounted: 10 };

    humanToggleContractSelection(game, firstContract.id);
    expect(game.humanState.selectedContractIds.includes(firstContract.id)).toBe(true);

    humanRunCampaign(game);
    expect(game.humanState.step).toBe('battle');

    // Regression check: render should not crash when selected ids are contract ids.
    const html = renderHumanControls(game, uiEconomyForGame);
    expect(html.includes('Battle:')).toBe(true);
    expect(html.includes(firstContract.title)).toBe(true);
  });
});
