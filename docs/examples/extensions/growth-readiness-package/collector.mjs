#!/usr/bin/env node

if (process.argv.includes("--verify")) {
  console.log("growth readiness metric contract ok");
  process.exit(0);
}

console.log(
  JSON.stringify({
    evidence: [
      {
        type: "metric_snapshot",
        summary: "Activation metric from package-shaped extension",
        content: {
          metric: "activation",
          source: "extension-package-fixture",
          threshold: 40,
          current: 48,
          sampleSize: 120
        }
      }
    ]
  })
);
