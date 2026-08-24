"""Transient LLM errors (CF 524, dropped connections) must be retried."""

from __future__ import annotations

import unittest

from flywheel.llm import LlmError, is_transient_llm_error


class TransientLlmErrorTests(unittest.TestCase):
    def test_status_codes(self) -> None:
        self.assertTrue(is_transient_llm_error(LlmError("LLM HTTP 524", status=524)))
        self.assertTrue(is_transient_llm_error(LlmError("LLM HTTP 503", status=503)))
        self.assertTrue(is_transient_llm_error(LlmError("LLM HTTP 502", status=502)))
        self.assertTrue(is_transient_llm_error(LlmError("LLM HTTP 429", status=429)))
        self.assertFalse(is_transient_llm_error(LlmError("LLM HTTP 400", status=400)))

    def test_dropped_connection_text(self) -> None:
        self.assertTrue(is_transient_llm_error(LlmError("LLM request failed: Remote end closed connection without response")))
        self.assertTrue(is_transient_llm_error(LlmError("LLM request timed out")))
        self.assertTrue(is_transient_llm_error(LlmError("LLM request failed: Connection reset by peer")))
        self.assertTrue(is_transient_llm_error(LlmError(
            "LLM request failed: [SSL: UNEXPECTED_EOF_WHILE_READING] "
            "EOF occurred in violation of protocol (_ssl.c:1016)"
        )))
        self.assertFalse(is_transient_llm_error(LlmError("empty LLM content")))


if __name__ == "__main__":
    unittest.main()
