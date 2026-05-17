import { runSimulation } from './gameEngine';

export function startSimulationMode(app, config, ruleset, api, renderGameFn) {
  try {
    const game = api.createGame({ mode: 'simulation', playerCount: config.playerCount, humanPlayers: 0, disableEvents: config.disableEvents });
    runSimulation(game);
    renderGameFn(game);
  } catch (err) {
    console.error('Simulation error:', err);
    app.innerHTML = `<main class="layout"><section class="panel"><h2>Error: ${err.message}</h2><pre>${err.stack}</pre></section></main>`;
  }
}
