const collector = process.argv[2];

const fixtures = {
  "posthog-activation": {
    type: "metric_snapshot",
    summary: "PostHog activation metric fixture",
    content: {
      metric: "activation",
      source: "posthog_fixture",
      threshold: 40,
      current: 48,
      real_user_analytics: true
    }
  },
  "vercel-deployment": {
    type: "release_plan",
    summary: "Vercel deployment status fixture",
    content: {
      platform: "vercel",
      deploymentStatus: "ready",
      deploymentTier: "staging_deployment",
      rollback: "vercel rollback <deployment-id>"
    }
  },
  "sentry-error-rate": {
    type: "observability",
    summary: "Sentry error-rate fixture",
    content: {
      platform: "sentry",
      errorRate: 0.001,
      alerting: "configured",
      real_user_analytics: true
    }
  },
  "github-actions-ci": {
    type: "decision",
    summary: "GitHub Actions CI fixture",
    content: {
      platform: "github actions",
      conclusion: "success",
      ci_verified: true
    }
  }
};

const evidence = fixtures[collector];

if (evidence === undefined) {
  console.error(`Unknown Runstead extension fixture: ${collector}`);
  process.exit(1);
}

console.log(JSON.stringify({ evidence: [evidence] }));
