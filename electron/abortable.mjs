/** Abort the caller's wait even when a transport/body ignores its signal. */
export function abortable(operation, signal) {
  if (!signal) return Promise.resolve().then(operation);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      callback(value);
    };
    const aborted = () => finish(reject, signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
