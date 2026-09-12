# Chapter 3-4 regression fixture

This fixture verifies the reviewed Flea PC -> STA producer cutover without using Production data.

The PostgreSQL fixture contains only synthetic identities and server-state rows. It checks permanent identity/earned timestamp preservation, deterministic legacy backfill, Core stat thresholds, client fail-closed behavior, cross-producer binding rejection and the frozen 35-item legacy collection contract.
