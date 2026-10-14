import { run } from "./commands";

const code = await run(process.argv.slice(2), {
  io: { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`) },
});
process.exit(code);
