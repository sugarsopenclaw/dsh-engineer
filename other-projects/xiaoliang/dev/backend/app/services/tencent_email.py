from __future__ import annotations

import json
import logging
from typing import Any

from app.core.config import Settings
from app.core.errors import AppError

logger = logging.getLogger(__name__)


def _tencent_configured(settings: Settings) -> bool:
    sid = (settings.tencent_secret_id or "").strip()
    sk = (settings.tencent_secret_key or "").strip()
    if not sid or not sk:
        return False
    if sid.lower() in {"replace-me", "changeme"} or sk.lower() in {"replace-me", "changeme"}:
        return False
    return True


def build_template_data_json(settings: Settings, code: str) -> str:
    """
    腾讯云模板里占位符名必须与 JSON 键一致，例如 {{code}} 对应 "code"。
    同时填充 code / content 两种常见键，避免控制台写 {{code}} 而配置里仍是 content。
    """
    extra: dict[str, Any] = {}
    raw = (settings.tencent_template_extra_vars or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                extra = parsed
        except json.JSONDecodeError:
            logger.warning("TENCENT_TEMPLATE_EXTRA_VARS 不是合法 JSON，已忽略。")
    out: dict[str, Any] = {**extra}
    out["code"] = code
    out["content"] = code
    custom = (settings.tencent_template_code_key or "").strip()
    if custom:
        out[custom] = code
    return json.dumps(out, ensure_ascii=False)


def send_login_otp_email(settings: Settings, *, to_email: str, code: str) -> None:
    """
    使用腾讯云邮件推送（SES）发送登录验证码。
    未配置密钥或模板 ID 时仅打日志，便于本地开发。
    """
    if not _tencent_configured(settings) or settings.tencent_template_id <= 0:
        logger.warning(
            "[email-otp] 未配置腾讯云发信或 TENCENT_TEMPLATE_ID=0，验证码（仅开发可见） to=%s code=%s",
            to_email,
            code,
        )
        return

    from tencentcloud.common import credential
    from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.ses.v20201002 import models, ses_client

    cred = credential.Credential(settings.tencent_secret_id, settings.tencent_secret_key)
    http_profile = HttpProfile()
    http_profile.endpoint = "ses.tencentcloudapi.com"
    client_profile = ClientProfile()
    client_profile.httpProfile = http_profile
    client = ses_client.SesClient(cred, settings.tencent_region, client_profile)

    req = models.SendEmailRequest()
    req.FromEmailAddress = settings.tencent_from_email
    req.Destination = [to_email]
    req.Subject = settings.email_otp_mail_subject
    req.TriggerType = 1

    tmpl = models.Template()
    tmpl.TemplateID = int(settings.tencent_template_id)
    tmpl.TemplateData = build_template_data_json(settings, code)
    req.Template = tmpl

    try:
        client.SendEmail(req)
    except TencentCloudSDKException as exc:
        logger.exception("腾讯云发信失败")
        raise AppError(502, f"邮件发送失败：{exc}", error_code="email_send_failed") from exc
