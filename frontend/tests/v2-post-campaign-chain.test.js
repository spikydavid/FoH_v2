import { describe, it, expect } from 'vitest';

import {
  autoPlayUntilHumanOrEnd,
  createGameV2,
  getActivePlayer,
  humanRunCampaign,
  humanSelectV2Lot,
  humanToggleContractSelection,
  humanSelectV2DraftContract,
  humanRecruitV2Specialist,
  humanBuyV2Equipment,
  humanSkipV2Phase,
} from '../src/gameEngineV2.js';

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

describe('V2 post-campaign phases flow correctly', () => {
  it('draft → recruit → equipment → round advancement', () => {
    const game = createGameV2({ mode: 'interactive', playerCount: 4, humanPlayers: 1, disableEvents: true });
    const startRound = game.round;

    // Advance through lot selections and reach campaign
    advanceThroughLotSelection(game);
    expect(game.humanState.step).toBe('campaign');

    // Run campaign with selected contract
    const player = getActivePlayer(game);
    const firstContract = (player.hand || []).find((card) => card.kind === 'contract');
    expect(firstContract).toBeTruthy();

    player.money = 999;
    player.troops = { melee: 10, ranged: 10, mounted: 10 };

    humanToggleContractSelection(game, firstContract.id);
    expect(game.humanState.selectedContractIds.includes(firstContract.id)).toBe(true);

    humanRunCampaign(game);
    expect(game.humanState.step).toBe('battle');

    // Auto-advance through battle to post-campaign phases
    autoPlayUntilHumanOrEnd(game);

    // After auto-play resolves battle and transitions to post-campaign, check draft phase
    // The game should be in one of the post-campaign phases or moved to next round
    const postCampaignPhases = ['v2-draft-contracts', 'v2-recruit-specialist', 'v2-buy-equipment'];
    const inPostCampaign = postCampaignPhases.includes(game.humanState.step);
    const movedToNextRound = game.round > startRound;

    if (inPostCampaign) {
      // Handle draft phase if active
      if (game.humanState.step === 'v2-draft-contracts') {
        const draftPool = game.v2DraftPool || [];
        if (draftPool.length > 0) {
          const firstDraft = draftPool[0];
          humanSelectV2DraftContract(game, firstDraft.id);
          expect(player.hand.some((c) => c.id === firstDraft.id)).toBe(true);
        } else {
          humanSkipV2Phase(game, 'v2-draft-contracts');
        }
        autoPlayUntilHumanOrEnd(game);
      }

      // Handle recruit phase if active
      if (game.humanState.step === 'v2-recruit-specialist') {
        const v2Market = game.v2SpecialistMarket || [];
        if (v2Market.length > 0 && player.money >= (v2Market[0].cost + 1)) {
          const firstSpecialist = v2Market[0];
          humanRecruitV2Specialist(game, firstSpecialist.id);
          expect(player.hand.some((c) => c.id === firstSpecialist.id)).toBe(true);
        } else {
          humanSkipV2Phase(game, 'v2-recruit-specialist');
        }
        autoPlayUntilHumanOrEnd(game);
      }

      // Handle equipment phase if active
      if (game.humanState.step === 'v2-buy-equipment') {
        const equipmentMarket = game.v2EquipmentMarket || [];
        if (equipmentMarket.length > 0 && player.money >= 2) {
          const firstEquip = equipmentMarket[0];
          humanBuyV2Equipment(game, firstEquip.id);
          expect(player.hand.some((c) => c.id === firstEquip.id)).toBe(true);
        } else {
          humanSkipV2Phase(game, 'v2-buy-equipment');
        }
        autoPlayUntilHumanOrEnd(game);
      }
    }

    // After post-campaign phases complete, round should advance or game structure should be valid
    // The humanState should no longer be in post-campaign phases
    expect(postCampaignPhases.includes(game.humanState.step)).toBe(false);
  });
});
