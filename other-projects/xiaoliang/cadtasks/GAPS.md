# Intentional capability gaps

1. Declared schedule quantity is unavailable until an upstream
   `schedule.row_segmentation` fact exists. A table grid and its row count are
   not treated as item quantities.
2. Identity is not merged across independently stored drawings. Multi-source
   physical-instance requests return `cross_file_identity` as a data gap.
3. Area is read only from an L2 `area` feature or an L1 persisted face record.
   The task layer does not reconstruct boundaries or maintain another geometry
   engine.
4. Result invalidation is manifest-granular in this release. A changed upstream
   manifest marks dependent results stale; field-level propagation is deferred.
5. The deterministic plan composer does not invent unregistered recipes. It
   reports an explicit capability gap.
6. Aggregate representations and their member representations remain distinct.
   `assembly_policy` defaults to member counting, while aggregate groups are
   emitted as a separate claim and table field.
7. In-DAG `decide` / `act` / `validate` stages are deliberate pass-throughs in
   the read-only recipes. Claim, issue, and result validation runs as
   independent post-DAG validators; a future write-capable block in `act` must
   wire a real in-DAG validation node instead of inheriting the pass-through.
