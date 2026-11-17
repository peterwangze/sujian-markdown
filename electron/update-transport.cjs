const { Readable } = require('node:stream');

const streamBuffer = 64 * 1024;

function result(status, headers, body = null) {
  return { status, ok: status >= 200 && status < 300, headers, body };
}

function responseHeaders(values) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    for (const part of Array.isArray(value) ? value : [value]) headers.append(name, part);
  }
  return headers;
}

function createUpdateTransport(requestFactory) {
  return async (url, { signal, headers } = {}) => {
    signal?.throwIfAborted();
    const address = new URL(url);
    if (address.protocol !== 'https:' || address.username || address.password) throw new Error('更新请求需要 HTTPS 地址。');
    const accept = new Headers(headers).get('accept');
    const request = requestFactory({
      url: address.href,
      method: 'GET',
      headers: accept ? { Accept: accept } : {},
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      bypassCustomProtocolHandlers: true,
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      let response;
      let stopped = false;

      function fail(error) {
        if (response) response.destroy(error);
        else if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', abort);
          reject(error);
        }
      }

      function stop() {
        if (stopped) return;
        stopped = true;
        request.abort();
      }

      function abort() {
        fail(signal.reason);
        stop();
      }

      // ClientRequest's Writable can close after end() before Chromium receives headers.
      request.on('error', fail);
      request.once('abort', () => fail(signal?.reason ?? new DOMException('The request was aborted.', 'AbortError')));
      request.on('login', (_info, respond) => respond());
      request.once('redirect', (status, _method, location) => {
        if (settled) return;
        // Let Chromium cancel this hop. The updater checks Location before making another request.
        try {
          const received = new Headers({ Location: location });
          settled = true;
          signal?.removeEventListener('abort', abort);
          resolve(result(status, received));
        } catch (error) { fail(error); }
      });
      request.once('response', incoming => {
        if (settled) return;
        try {
          const received = responseHeaders(incoming.headers);
          const body = Readable.toWeb(incoming, {
            strategy: { highWaterMark: streamBuffer, size: chunk => chunk.byteLength },
          });
          response = incoming;
          incoming.once('aborted', () => fail(signal?.reason ?? new Error('更新连接中断。')));
          incoming.once('close', () => {
            signal?.removeEventListener('abort', abort);
            if (!incoming.readableEnded) stop();
          });
          settled = true;
          resolve(result(incoming.statusCode, received, body));
        } catch (error) {
          fail(error);
          stop();
        }
      });

      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) abort();
        else request.end();
      } catch (error) {
        fail(error);
        stop();
      }
    });
  };
}

module.exports = { createUpdateTransport };
