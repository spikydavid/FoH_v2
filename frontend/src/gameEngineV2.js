import {
  createGame as createClassicGame,
  runMultipleSimulations as runClassicMultipleSimulations,
} from './gameEngine';

export * from './gameEngine';

export function createGameV2(config = {}) {
  return createClassicGame({ ...config, ruleset: 'v2' });
}

export function runMultipleSimulationsV2(config, count) {
  return runClassicMultipleSimulations({ ...config, ruleset: 'v2' }, count);
}
