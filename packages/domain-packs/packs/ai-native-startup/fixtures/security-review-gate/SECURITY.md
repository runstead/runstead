# Security Review Notes

Protected surfaces:

- `.env.example` documents required secrets without real values.
- `billing/` is launch-blocked until pricing and payment-webhook review exists.
- `compliance/privacy-notes.md` must cite product claims before public launch.

Current review decision:

- allow local demo with fake credentials
- block public launch until dependency and privacy evidence are recorded
