import { sum } from "../src/sum.mjs";

if (sum(2, 3) !== 5) {
  console.error("expected sum(2, 3) to equal 5");
  process.exit(1);
}
