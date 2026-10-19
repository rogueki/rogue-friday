// Fixed-purpose Baileys logout for the pinned Hermes bridge. Called only after
// Friday has stopped the gateway and verified the profile's bridge is offline.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [bridgeScript, sessionDir] = process.argv.slice(2);
if (!bridgeScript || !sessionDir) process.exit(2);
const requireFromBridge = createRequire(pathToFileURL(resolve(bridgeScript)));
const moduleUrl = pathToFileURL(requireFromBridge.resolve('@whiskeysockets/baileys')).href;
const { makeWASocket, useMultiFileAuthState } = await import(moduleUrl);
const { default: pino } = await import(pathToFileURL(requireFromBridge.resolve('pino')).href);
const { state } = await useMultiFileAuthState(resolve(sessionDir));
const sock = makeWASocket({ auth: state, printQRInTerminal: false,
  logger: pino({ level: 'silent' }),
  browser: ['Hermes Agent', 'Chrome', '120.0'], syncFullHistory: false, markOnlineOnConnect: false,
  getMessage: async () => ({ conversation: '' }) });
let finished = false;
const finish = (ok) => {
  if (finished) return;
  finished = true;
  process.stdout.write(JSON.stringify({ loggedOut: ok }) + '\n');
  try { sock.end(); } catch { /* The socket may already be closed after logout or timeout. */ }
  process.exit(ok ? 0 : 1);
};
setTimeout(() => finish(false), 20000).unref();
sock.ev.on('connection.update', async ({ connection, qr }) => {
  if (qr) return finish(false);
  if (connection === 'open') {
    try { await sock.logout(); finish(true); } catch { finish(false); }
  }
  if (connection === 'close' && !finished) finish(false);
});
