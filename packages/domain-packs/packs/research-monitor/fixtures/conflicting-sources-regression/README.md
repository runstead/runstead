# Conflicting Sources Regression

This fixture represents a monitored topic where two sources disagree on a
material claim. The expected behavior is to cite both sources, record the
conflict, mark uncertainty, and avoid flattening the disagreement into a single
unsupported digest claim.

The fixture also requires source reliability scores so the conflict triage can
separate source quality from claim disagreement.
