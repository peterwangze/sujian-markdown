const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Readable } = require('node:stream');
const { setImmediate } = require('node:timers/promises');
const { test } = require('node:test');
const { createUpdateTransport } = require('./update-transport.cjs');

const source = 'https://github.com/peterwangze/sujian-markdown/releases/latest';
const cdn = 'https://release-assets.githubusercontent.com/example';

function fixture(start) {
  const calls = [];
  const request = new EventEmitter();
  request.abortCalls = 0;
  request.abort = () => {
    request.abortCalls++;
    request.emit('abort');
  };
  request.followRedirect = () => assert.fail('Update checker must validate redirects before connecting');
  request.end = () => queueMicrotask(() => {
    request.emit('close'); // The Writable can finish before network headers arrive in Electron.
    if (!request.abortCalls) start(request);
  });
  const transport = createUpdateTransport(options => {
    calls.push(options);
    return request;
  });
  return { calls, request, transport };
}

function incoming(body, headers = {}) {
  return Object.assign(body, { statusCode: 200, headers });
}

test('uses Chromium request controls and returns redirects to the allowlist caller', async () => {
  let credentials;
  const { calls, transport } = fixture(request => {
    request.emit('login', { isProxy: true }, (...args) => { credentials = args; });
    request.emit('redirect', 302, 'GET', cdn);
    request.emit('error', new Error('Redirect was cancelled'));
  });
  const response = await transport(source, { headers: { Accept: 'application/vnd.github+json', Cookie: 'private', Authorization: 'private' } });
  assert.deepEqual(credentials, []);
  assert.deepEqual(calls, [{
    url: source, method: 'GET', headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit',
    cache: 'no-store', redirect: 'manual', bypassCustomProtocolHandlers: true,
  }]);
  assert.equal(response.status, 302);
  assert.equal(response.ok, false);
  assert.equal(response.headers.get('location'), cdn);
  assert.equal(response.body, null);
  await assert.rejects(transport('http://github.com/example'), /HTTPS/);
  await assert.rejects(transport('https://user:password@github.com/example'), /HTTPS/);
  assert.equal(calls.length, 1);
});

test('streams native response bytes and preserves errors after headers', async () => {
  const bytes = [Buffer.from('part 1'), Buffer.from('part 2')];
  const ready = fixture(request => request.emit('response', incoming(Readable.from(bytes), { 'Content-Length': '12' })));
  const response = await ready.transport(cdn);
  assert.equal(response.ok, true);
  assert.equal(response.headers.get('content-length'), '12');
  const consumed = [];
  for await (const chunk of response.body) consumed.push(chunk);
  assert.deepEqual(Buffer.concat(consumed), Buffer.concat(bytes));
  assert.equal(ready.request.abortCalls, 0);

  const connection = new PassThrough();
  const interrupted = fixture(request => request.emit('response', incoming(connection)));
  const partial = await interrupted.transport(cdn);
  const reader = partial.body.getReader();
  connection.write(bytes[0]);
  assert.deepEqual(Buffer.from((await reader.read()).value), bytes[0]);
  const error = new Error('connection reset');
  interrupted.request.emit('error', error);
  await assert.rejects(reader.read(), error);
  assert.equal(interrupted.request.abortCalls, 1);
});

test('cancels Chromium before headers and during body reads', async () => {
  const wait = fixture(() => {});
  const cancelledEarly = new AbortController();
  const pending = wait.transport(source, { signal: cancelledEarly.signal });
  const reason = new Error('caller cancelled');
  cancelledEarly.abort(reason);
  await assert.rejects(pending, reason);
  assert.equal(wait.request.abortCalls, 1);
  await assert.rejects(wait.transport(source, { signal: cancelledEarly.signal }), reason);
  assert.equal(wait.calls.length, 1);

  const body = new PassThrough();
  const bodyFixture = fixture(request => request.emit('response', incoming(body)));
  const cancelledLater = new AbortController();
  const response = await bodyFixture.transport(cdn, { signal: cancelledLater.signal });
  const read = response.body.getReader().read();
  cancelledLater.abort(reason);
  await assert.rejects(read, reason);
  assert.equal(body.destroyed, true);
  assert.equal(bodyFixture.request.abortCalls, 1);
});

test('applies byte backpressure and stops the network when the response is discarded', async () => {
  const chunk = Buffer.alloc(64 * 1024);
  let produced = 0;
  const body = Readable.from((function* () {
    while (produced < 100) { produced++; yield chunk; }
  })(), { objectMode: false });
  const fixtureStream = fixture(request => request.emit('response', incoming(body)));
  const response = await fixtureStream.transport(cdn);
  await setImmediate();
  assert.ok(produced > 0 && produced < 10, `Buffered ${produced} chunks`);
  const closed = new Promise(resolve => body.once('close', resolve));
  await response.body.cancel();
  await closed;
  assert.equal(body.destroyed, true);
  assert.equal(fixtureStream.request.abortCalls, 1);
});
