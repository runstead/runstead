# Archive Memory Update Fixture

This fixture represents the post-review archive step for a recurring monitor.
The expected behavior is to persist durable claim ids, source ids, unresolved
questions, and watch items for the next cycle after the digest is reviewed.

Expected evidence:

- durable source ids are copied into the archive record
- claim ids are stable across cycles
- unresolved questions are retained
- archive writes are recorded separately from external publishing
