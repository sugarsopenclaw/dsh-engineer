from __future__ import annotations

import unittest

from app.core.errors import AppError
from app.domain.billing.errors import BillingErrorCode
from app.services.billing.wechat_native_pay import WeChatNativePayClient


class RejectingCallbackSdk:
    def callback(self, **kwargs):
        raise Exception("invalid callback signature")


class WeChatNativePayClientTests(unittest.TestCase):
    def test_invalid_callback_signature_returns_business_error(self) -> None:
        client = WeChatNativePayClient.__new__(WeChatNativePayClient)
        client._client = RejectingCallbackSdk()

        with self.assertRaises(AppError) as raised:
            client.parse_notify(
                {
                    "Wechatpay-Signature": "invalid",
                    "Wechatpay-Timestamp": "0",
                    "Wechatpay-Nonce": "invalid",
                    "Wechatpay-Serial": "invalid",
                },
                b"{}",
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.error_code, BillingErrorCode.WECHATPAY_NOTIFY_INVALID)


if __name__ == "__main__":
    unittest.main()