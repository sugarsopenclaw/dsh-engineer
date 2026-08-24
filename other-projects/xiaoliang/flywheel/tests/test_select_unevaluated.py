"""--limit must pick only unevaluated fingerprints, capped at N."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from flywheel.judge import claim_pending_wave, clamp_workers, select_unevaluated
from flywheel.llm import _model_fallbacks


class SelectUnevaluatedTests(unittest.TestCase):
    def test_returns_only_unevaluated_ids_capped_at_n(self) -> None:
        turns = [
            SimpleNamespace(case_id="old-a", fingerprint="fp-a"),
            SimpleNamespace(case_id="new-b", fingerprint="fp-b"),
            SimpleNamespace(case_id="old-c", fingerprint="fp-c"),
            SimpleNamespace(case_id="new-d", fingerprint="fp-d"),
            SimpleNamespace(case_id="new-e", fingerprint="fp-e"),
        ]
        judged = {"fp-a", "fp-c"}
        picked = select_unevaluated(turns, judged, limit=2)
        self.assertEqual([item.case_id for item in picked], ["new-b", "new-d"])
        self.assertTrue(all(item.fingerprint not in judged for item in picked))
        self.assertEqual(len(picked), 2)

    def test_none_limit_returns_all_pending(self) -> None:
        turns = [
            SimpleNamespace(case_id="a", fingerprint="1"),
            SimpleNamespace(case_id="b", fingerprint="2"),
            SimpleNamespace(case_id="c", fingerprint="3"),
        ]
        picked = select_unevaluated(turns, {"2"}, limit=None)
        self.assertEqual([item.case_id for item in picked], ["a", "c"])


class ClaimPendingWaveTests(unittest.TestCase):
    def test_five_workers_claim_disjoint_one_wave(self) -> None:
        turns = [
            SimpleNamespace(case_id=f"c{i}", fingerprint=f"fp-{i}") for i in range(10)
        ]
        judged = {"fp-0", "fp-1"}
        groups = claim_pending_wave(turns, judged, workers=5)
        self.assertEqual(len(groups), 5)
        claimed_sets = [{item.fingerprint for item in group} for group in groups]
        for i, left in enumerate(claimed_sets):
            for right in claimed_sets[i + 1 :]:
                self.assertTrue(left.isdisjoint(right))
        union = set().union(*claimed_sets)
        self.assertEqual(len(union), 5)
        self.assertTrue(union.isdisjoint(judged))
        self.assertTrue(all(fp.startswith("fp-") for fp in union))

    def test_fewer_pending_than_workers_returns_full_pending(self) -> None:
        turns = [
            SimpleNamespace(case_id="a", fingerprint="x"),
            SimpleNamespace(case_id="b", fingerprint="y"),
        ]
        groups = claim_pending_wave(turns, set(), workers=5)
        union = {item.fingerprint for group in groups for item in group}
        self.assertEqual(union, {"x", "y"})
        claimed_sets = [{item.fingerprint for item in group} for group in groups]
        for i, left in enumerate(claimed_sets):
            for right in claimed_sets[i + 1 :]:
                self.assertTrue(left.isdisjoint(right))

    def test_skips_already_judged_and_duplicate_fingerprints(self) -> None:
        turns = [
            SimpleNamespace(case_id="a", fingerprint="fp-a"),
            SimpleNamespace(case_id="a2", fingerprint="fp-a"),
            SimpleNamespace(case_id="b", fingerprint="fp-b"),
            SimpleNamespace(case_id="c", fingerprint="fp-c"),
        ]
        groups = claim_pending_wave(turns, {"fp-b"}, workers=5)
        fps = [item.fingerprint for group in groups for item in group]
        self.assertEqual(fps, ["fp-a", "fp-c"])

    def test_workers_clamped_to_five(self) -> None:
        self.assertEqual(clamp_workers(99), 5)
        self.assertEqual(clamp_workers(0), 1)
        self.assertEqual(clamp_workers(5), 5)


class ModelFallbackTests(unittest.TestCase):
    def test_latest_alias_adds_base_id(self) -> None:
        self.assertEqual(
            _model_fallbacks("grok-4.6-latest"),
            ["grok-4.6-latest", "grok-4.6"],
        )

    def test_plain_id_unchanged(self) -> None:
        self.assertEqual(_model_fallbacks("grok-4.6"), ["grok-4.6"])


if __name__ == "__main__":
    unittest.main()
