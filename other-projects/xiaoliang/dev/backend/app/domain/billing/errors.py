from __future__ import annotations

from enum import StrEnum


class BillingErrorCode(StrEnum):
    QUOTA_EXCEEDED = "quota_exceeded"
    BILLING_PRODUCT_NOT_FOUND = "billing_product_not_found"
    BILLING_ORDER_NOT_FOUND = "billing_order_not_found"
    BILLING_ORDER_CONFLICT = "billing_order_conflict"
    WECHATPAY_NOT_CONFIGURED = "wechat_pay_not_configured"
    WECHATPAY_NOT_INSTALLED = "wechat_pay_not_installed"
    WECHATPAY_PRIVATE_KEY_MISSING = "wechat_pay_private_key_missing"
    WECHATPAY_CREATE_ORDER_FAILED = "wechat_pay_failed"
    WECHATPAY_QUERY_ORDER_FAILED = "wechat_pay_query_failed"
    WECHATPAY_NOTIFY_INVALID = "wechat_pay_notify_invalid"
    WECHATPAY_NOTIFY_MISMATCH = "wechat_pay_notify_mismatch"
    INVALID_USAGE_CHARGE = "invalid_usage_charge"
    MODEL_NOT_ALLOWED = "model_not_allowed"
