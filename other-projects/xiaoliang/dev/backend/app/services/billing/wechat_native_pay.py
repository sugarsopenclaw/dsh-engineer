from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.domain.billing.errors import BillingErrorCode

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WeChatNativeOrderResult:
    code_url: str
    raw: dict[str, Any]


class WeChatNativePayClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        try:
            from wechatpayv3 import WeChatPay, WeChatPayType
        except ImportError as exc:
            raise AppError(
                500,
                "微信支付依赖未安装。",
                error_code=BillingErrorCode.WECHATPAY_NOT_INSTALLED,
            ) from exc

        app_id = (self.settings.wechatpay_app_id or "").strip()
        mch_id = (self.settings.wechatpay_mch_id or "").strip()
        serial_no = (self.settings.wechatpay_cert_serial_no or "").strip()
        api_v3_key = (self.settings.wechatpay_apiv3_key or "").strip()
        private_key_file = Path(self.settings.wechatpay_private_key_path)
        if not app_id or not mch_id or not serial_no or not api_v3_key:
            raise AppError(
                500,
                "微信支付配置不完整。",
                error_code=BillingErrorCode.WECHATPAY_NOT_CONFIGURED,
            )
        if not private_key_file.is_absolute():
            private_key_file = Path(__file__).resolve().parents[3] / private_key_file
        if not private_key_file.exists():
            raise AppError(
                500,
                "微信支付私钥文件不存在。",
                error_code=BillingErrorCode.WECHATPAY_PRIVATE_KEY_MISSING,
                details={"path": str(private_key_file)},
            )

        cert_dir = Path(self.settings.wechatpay_cert_dir)
        if not cert_dir.is_absolute():
            cert_dir = Path(__file__).resolve().parents[3] / cert_dir
        cert_dir.mkdir(parents=True, exist_ok=True)

        private_key = private_key_file.read_text(encoding="utf-8")
        self._wechatpay_type = WeChatPayType.NATIVE
        self._client = WeChatPay(
            wechatpay_type=WeChatPayType.NATIVE,
            mchid=mch_id,
            private_key=private_key,
            cert_serial_no=serial_no,
            apiv3_key=api_v3_key,
            appid=app_id,
            notify_url=self.settings.wechatpay_notify_url,
            cert_dir=str(cert_dir),
            logger=logger,
        )

    def create_native_order(
        self,
        *,
        description: str,
        out_trade_no: str,
        amount_fen: int,
        expires_at: datetime,
    ) -> WeChatNativeOrderResult:
        status_code, message = self._client.pay(
            description=description,
            out_trade_no=out_trade_no,
            amount={"total": amount_fen, "currency": "CNY"},
            time_expire=expires_at.isoformat(timespec="seconds"),
            notify_url=self.settings.wechatpay_notify_url,
            pay_type=self._wechatpay_type,
        )
        data = self._decode_message(message)
        if status_code != 200 or not data.get("code_url"):
            wechat_code = self._safe_log_text(data.get("code"), max_length=64) or "UNKNOWN"
            wechat_message = self._safe_log_text(
                data.get("message") or data.get("raw"),
                max_length=500,
            ) or "No message returned."
            logger.warning(
                "WeChat Native order rejected: status_code=%s code=%s message=%s",
                status_code,
                wechat_code,
                wechat_message,
            )
            raise AppError(
                502,
                f"微信支付下单失败（{wechat_code}）。",
                error_code=BillingErrorCode.WECHATPAY_CREATE_ORDER_FAILED,
                details={"status_code": status_code, "response": self._safe_response(data)},
            )
        return WeChatNativeOrderResult(code_url=str(data["code_url"]), raw=data)

    def query_order(self, *, out_trade_no: str) -> dict[str, Any]:
        code, message = self._client.query(out_trade_no=out_trade_no)
        data = self._decode_message(message)
        if code != 200:
            raise AppError(
                502,
                "微信支付查单失败。",
                error_code=BillingErrorCode.WECHATPAY_QUERY_ORDER_FAILED,
                details={"status_code": code, "response": self._safe_response(data)},
            )
        return data

    def parse_notify(self, headers: dict[str, str | None], body: bytes) -> dict[str, Any]:
        try:
            result = self._client.callback(headers=headers, body=body)
        except Exception as exc:
            logger.warning("WeChat Pay notify validation failed: %s", type(exc).__name__)
            raise AppError(
                400,
                "微信支付回调验签失败。",
                error_code=BillingErrorCode.WECHATPAY_NOTIFY_INVALID,
            ) from exc
        if not isinstance(result, dict):
            raise AppError(
                400,
                "微信支付回调验签失败。",
                error_code=BillingErrorCode.WECHATPAY_NOTIFY_INVALID,
            )
        return result

    def _decode_message(self, message: Any) -> dict[str, Any]:
        if isinstance(message, dict):
            return message
        if isinstance(message, bytes):
            message = message.decode("utf-8")
        if isinstance(message, str) and message:
            try:
                data = json.loads(message)
                return data if isinstance(data, dict) else {"raw": data}
            except json.JSONDecodeError:
                return {"raw": message}
        return {}

    def _safe_response(self, data: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value
            for key, value in data.items()
            if "key" not in key.lower() and "secret" not in key.lower()
        }

    def _safe_log_text(self, value: Any, *, max_length: int) -> str:
        normalized = " ".join(str(value or "").split())
        return normalized[:max_length]
