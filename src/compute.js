import SolverWorker from './solver.worker.js?worker&inline';
import {runWorker} from './compute-task.js';
// Published builds embed the worker code, so later calculations need no network.
export const compute = (input, options = {}) => runWorker(input, {
  ...options, createWorker: () => new SolverWorker({type: 'module'})
});
