import { main } from "../src/main";
import { simulation } from "./simulation";

// The Playwright stack runs this bundle (.e2e-dist/e2e-server.js): the shipped server plus the mock world.
main({ simulation }).catch((error) => {
  console.error(error);
  process.exit(1);
});
