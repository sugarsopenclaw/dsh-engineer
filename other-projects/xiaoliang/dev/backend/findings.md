# Backend Findings

- The existing backend is a single-file FastAPI service used for version checks only.
- The frontend currently has only a thin HTTP API placeholder and will tolerate a clean backend expansion.
- Old `cost-agent-skillmesh` persistence splits evidence into confirmed geometry, algorithm registry, and ledgers; these should become backend entities later.
- The first implemented backend capability should be auth plus tenant setup, not CAD routing logic.
- Desktop auto-update is already managed by Electron + GitHub Releases, so backend release endpoints should be removed rather than preserved.
- The current product direction no longer needs `private/team/global` visibility; approved skills should publish into one shared library, while organization data remains for provenance and auth.