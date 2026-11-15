import {AppError} from './core/rules.js';
export function runWorker(input, {signal, timeoutMs = 60000, createWorker, onBusy = () => {}}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AppError('计算已取消，输入仍保留。')); return; }
    let worker, timer, settled = false;
    const abort = () => finish(new AppError('计算已取消，输入仍保留。'));
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker?.terminate(); onBusy(false);
      error ? reject(error) : resolve(result);
    };
    try {
      worker = createWorker();
      worker.onmessage = ({data}) => finish(data.error ? new AppError(data.error, data.status) : null, data.result);
      worker.onerror = () => finish(new AppError('计算线程异常，输入仍保留，请重试。'));
      worker.onmessageerror = () => finish(new AppError('无法读取计算结果，输入仍保留，请重试。'));
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => finish(new AppError('计算超过 60 秒，已停止。输入仍保留，请重试。')), timeoutMs);
      onBusy(true);
      if (settled) return;
      worker.postMessage(input);
    } catch { finish(new AppError('无法启动浏览器计算线程，请使用较新的浏览器重试。')); }
  });
}
