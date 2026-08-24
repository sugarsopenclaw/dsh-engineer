import unittest

from flywheel.software_signals import analyze_turn


class SoftwareSignalsTests(unittest.TestCase):
    def test_tool_failure_from_result(self) -> None:
        metrics, signals = analyze_turn(
            [
                {"role": "user", "content": "定位入口"},
                {
                    "role": "assistant",
                    "tool_name": "cad_task_probe",
                    "tool_result": "CAD 精读结果：失败：未能在当前图纸定位到目标（status=target_not_resolved）",
                    "content": "我先精读",
                },
            ],
            [],
            [],
        )
        self.assertEqual(metrics["tool_fail"], 1)
        self.assertEqual(metrics["tool_ok"], 0)
        self.assertIn("tool_error", signals["kinds"])
        self.assertEqual(signals["level_hint"], "degraded")

    def test_aborted_run_is_hard_fail(self) -> None:
        _metrics, signals = analyze_turn(
            [{"role": "user", "content": "重新"}],
            [{"status": "failed", "error_message": "Request was aborted.", "duration_ms": 12}],
            [],
        )
        self.assertTrue(signals["hard_fail"])
        self.assertTrue(signals["aborted"])
        self.assertEqual(signals["level_hint"], "hard_fail")

    def test_clean_completed_run(self) -> None:
        metrics, signals = analyze_turn(
            [
                {"role": "user", "content": "你好"},
                {"role": "assistant", "content": "您好，我是晓量", "tool_name": ""},
            ],
            [{"status": "completed", "duration_ms": 2000}],
            [{"call_purpose": "main", "total_tokens": 100, "input_tokens": 80, "output_tokens": 20, "status": "completed"}],
        )
        self.assertEqual(metrics["total_tokens"], 100)
        self.assertEqual(signals["level_hint"], "clean")
        self.assertEqual(metrics["tool_ok"], 0)


if __name__ == "__main__":
    unittest.main()
