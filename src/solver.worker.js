import {analyze} from './core/analyze.js';
self.onmessage = ({data}) => {
  const start = performance.now();
  try {
    const result = analyze(data);
    self.postMessage({result: {...result, elapsedMs: Math.round((performance.now() - start) * 100) / 100}});
  } catch (error) {
    self.postMessage({error: error.message, status: error.status || 400});
  }
};
