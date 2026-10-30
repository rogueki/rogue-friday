import { hashPassword } from '../password';

const MIN_LENGTH = 12;

/** Reads a line from a TTY without echoing it. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(label);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stderr.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          reject(new Error('Aborted'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  let password: string;
  if (process.stdin.isTTY) {
    password = await promptHidden('Passwort: ');
    const confirm = await promptHidden('Wiederholen: ');
    if (password !== confirm) throw new Error('Passwörter stimmen nicht überein.');
  } else {
    password = await readStdin();
  }
  if (password.length < MIN_LENGTH) throw new Error(`Passwort muss mindestens ${MIN_LENGTH} Zeichen lang sein.`);

  const hash = await hashPassword(password);
  // Only a person reading a terminal needs the hint; a calling script (owner reset) stores the hash itself.
  if (process.stdout.isTTY) process.stderr.write('In .env eintragen (Single Quotes wegen der $-Zeichen):\n');
  process.stdout.write(`FRIDAY_OWNER_PASSWORD_HASH='${hash}'\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
