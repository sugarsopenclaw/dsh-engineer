from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import (
    BaseSettings,
    DotEnvSettingsSource,
    EnvSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)


_CSV_LIST_FIELDS = {
    "cors_origins",
    "patient_asr_allowed_extensions",
    "patient_asr_allowed_mime_types",
}

BILLING_DEFAULT_CREDIT_MARKUP = 10 / 9
BILLING_CREDIT_MARKUP_MAX_DRIFT_RATIO = 0.05
SERVER_THREAD_POOL_RESERVED_TOKENS = 40


class _CsvListEnvSettingsSource(EnvSettingsSource):
    def prepare_field_value(self, field_name: str, field: Any, value: Any, value_is_complex: bool) -> Any:
        if field_name in _CSV_LIST_FIELDS:
            return value
        return super().prepare_field_value(field_name, field, value, value_is_complex)


class _CsvListDotEnvSettingsSource(DotEnvSettingsSource):
    def prepare_field_value(self, field_name: str, field: Any, value: Any, value_is_complex: bool) -> Any:
        if field_name in _CSV_LIST_FIELDS:
            return value
        return super().prepare_field_value(field_name, field, value, value_is_complex)


class Settings(BaseSettings):
    _project_root = Path(__file__).resolve().parents[2]

    model_config = SettingsConfigDict(
        env_file=str(_project_root / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field("晓量后端服务", validation_alias="APP_NAME")
    app_version: str = Field("0.7.4", validation_alias="APP_VERSION")
    app_env: str = Field("development", validation_alias="APP_ENV")
    debug: bool = Field(False, validation_alias="DEBUG")
    cors_origins: list[str] = Field(
        default_factory=lambda: ["*"],
        validation_alias="CORS_ORIGINS",
    )
    # Sync endpoints run in the AnyIO worker threadpool; cloud document analysis can hold a
    # thread for minutes, so the default 40 tokens would starve auth/billing/sync endpoints.
    server_thread_pool_size: int = Field(
        160,
        validation_alias="SERVER_THREAD_POOL_SIZE",
        ge=40,
        le=1024,
    )

    database_url: str = Field("sqlite:///./xiaoliang_backend.db", validation_alias="DATABASE_URL")
    db_pool_size: int = Field(20, validation_alias="DB_POOL_SIZE", ge=1, le=200)
    db_max_overflow: int = Field(20, validation_alias="DB_MAX_OVERFLOW", ge=0, le=500)
    db_pool_timeout: float = Field(10.0, validation_alias="DB_POOL_TIMEOUT", ge=1)
    db_pool_recycle: int = Field(1_800, validation_alias="DB_POOL_RECYCLE", ge=30)
    auto_create_tables: bool = Field(True, validation_alias="AUTO_CREATE_TABLES")
    storage_root: str = Field("./storage", validation_alias="STORAGE_ROOT")
    client_release_manifest_path: str = Field(
        "./release-manifests/latest.json",
        validation_alias="CLIENT_RELEASE_MANIFEST_PATH",
    )
    client_release_assets_dir: str = Field(
        "./storage/client-releases",
        validation_alias="CLIENT_RELEASE_ASSETS_DIR",
    )
    release_admin_token: str = Field("", validation_alias="RELEASE_ADMIN_TOKEN")
    desktop_update_base_url: str = Field(
        "https://xl.x3yun.com/api/desktop-updates",
        validation_alias="DESKTOP_UPDATE_BASE_URL",
    )
    oss_release_signed_url_expires_seconds: int = Field(
        21600,
        validation_alias="OSS_RELEASE_SIGNED_URL_EXPIRES_SECONDS",
        ge=60,
    )

    # 桌面端运行时资产分发（bash/MinGit 等）。运维把资产上传到私有 OSS 后配置
    # 对象 key 与 SHA-256；未配置时接口 404，桌面端自动回退到国内公开镜像。
    runtime_asset_git_bash_object_key: str = Field(
        "",
        validation_alias="RUNTIME_ASSET_GIT_BASH_OBJECT_KEY",
    )
    runtime_asset_git_bash_sha256: str = Field(
        "",
        validation_alias="RUNTIME_ASSET_GIT_BASH_SHA256",
    )
    runtime_asset_git_bash_version: str = Field(
        "",
        validation_alias="RUNTIME_ASSET_GIT_BASH_VERSION",
    )
    runtime_asset_git_bash_size_bytes: int = Field(
        0,
        validation_alias="RUNTIME_ASSET_GIT_BASH_SIZE_BYTES",
        ge=0,
    )

    jwt_secret_key: str = Field(
        "change-me-in-production-at-least-32-bytes",
        validation_alias="JWT_SECRET_KEY",
    )
    jwt_algorithm: str = Field("HS256", validation_alias="JWT_ALGORITHM")
    # Desktop managed-model sessions use the access token as Bearer for the full agent turn.
    # 15 minutes is too short for CAD/costing workflows; default to 24h (refresh still supported).
    access_token_expires_minutes: int = Field(1440, validation_alias="ACCESS_TOKEN_EXPIRES_MINUTES")
    refresh_token_expires_days: int = Field(7, validation_alias="REFRESH_TOKEN_EXPIRES_DAYS")

    # 腾讯云邮件推送（验证码登录），与 .env.example 中 TENCENT_* 一致
    tencent_secret_id: str = Field("replace-me", validation_alias="TENCENT_SECRET_ID")
    tencent_secret_key: str = Field("replace-me", validation_alias="TENCENT_SECRET_KEY")
    tencent_region: str = Field("ap-hongkong", validation_alias="TENCENT_REGION")
    tencent_from_email: str = Field("noreply@example.com", validation_alias="TENCENT_FROM_EMAIL")
    tencent_template_id: int = Field(0, validation_alias="TENCENT_TEMPLATE_ID")
    tencent_template_code_key: str = Field("", validation_alias="TENCENT_TEMPLATE_CODE_KEY")
    tencent_template_extra_vars: str = Field("{}", validation_alias="TENCENT_TEMPLATE_EXTRA_VARS")

    email_otp_expires_minutes: int = Field(10, validation_alias="EMAIL_OTP_EXPIRES_MINUTES")
    email_otp_resend_seconds: int = Field(60, validation_alias="EMAIL_OTP_RESEND_SECONDS")
    email_otp_mail_subject: str = Field("晓量登录验证码", validation_alias="EMAIL_OTP_MAIL_SUBJECT")

    dashscope_base_url: str = Field(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        validation_alias="DASHSCOPE_BASE_URL",
    )
    dashscope_api_key: str = Field("", validation_alias="DASHSCOPE_API_KEY")
    agent_conversation_title_model: str = Field(
        "qwen3.7-max",
        validation_alias="AGENT_CONVERSATION_TITLE_MODEL",
    )
    agent_conversation_title_timeout_seconds: float = Field(
        15.0,
        validation_alias="AGENT_CONVERSATION_TITLE_TIMEOUT_SECONDS",
        ge=3,
        le=60,
    )
    qwen_web_search_model: str = Field("qwen3.8-max", validation_alias="QWEN_WEB_SEARCH_MODEL")
    qwen_web_fetch_model: str = Field("qwen3.8-max", validation_alias="QWEN_WEB_FETCH_MODEL")
    qwen_web_source_limit: int = Field(8, validation_alias="QWEN_WEB_SOURCE_LIMIT", ge=1, le=10)
    qwen_web_search_timeout_seconds: int = Field(
        90,
        validation_alias="QWEN_WEB_SEARCH_TIMEOUT_SECONDS",
        ge=10,
    )
    qwen_web_fetch_timeout_seconds: int = Field(
        180,
        validation_alias="QWEN_WEB_FETCH_TIMEOUT_SECONDS",
        ge=10,
    )
    # Bocha is the primary SERP for /web/search: it returns structured hits with no model
    # narration. The key stays server-side; without it the route falls back to Qwen.
    bocha_api_key: str = Field("", validation_alias="BOCHA_API_KEY")
    bocha_base_url: str = Field("https://api.bochaai.com/v1", validation_alias="BOCHA_BASE_URL")
    bocha_search_count: int = Field(10, validation_alias="BOCHA_SEARCH_COUNT", ge=1, le=50)
    bocha_timeout_seconds: int = Field(
        30,
        validation_alias="BOCHA_TIMEOUT_SECONDS",
        ge=5,
        le=120,
    )
    qwen_patient_asr_model: str = Field("qwen3-asr-flash", validation_alias="QWEN_PATIENT_ASR_MODEL")
    qwen_patient_asr_enable_itn: bool = Field(False, validation_alias="QWEN_PATIENT_ASR_ENABLE_ITN")
    qwen_patient_asr_language: str = Field("", validation_alias="QWEN_PATIENT_ASR_LANGUAGE")
    patient_asr_max_file_size_mb: int = Field(10, validation_alias="PATIENT_ASR_MAX_FILE_SIZE_MB")
    patient_asr_allowed_extensions: list[str] = Field(
        default_factory=lambda: [
            ".webm",
            ".wav",
            ".mp3",
            ".m4a",
            ".ogg",
            ".opus",
            ".aac",
            ".flac",
            ".amr",
        ],
        validation_alias="PATIENT_ASR_ALLOWED_EXTENSIONS",
    )
    patient_asr_allowed_mime_types: list[str] = Field(
        default_factory=lambda: [
            "audio/webm",
            "audio/wav",
            "audio/mpeg",
            "audio/mp4",
            "audio/ogg",
            "audio/opus",
            "audio/aac",
            "audio/flac",
            "audio/amr",
            "video/webm",
            "application/octet-stream",
        ],
        validation_alias="PATIENT_ASR_ALLOWED_MIME_TYPES",
    )

    alibaba_cloud_access_key_id: str = Field("", validation_alias="ALIBABA_CLOUD_ACCESS_KEY_ID")
    alibaba_cloud_access_key_secret: str = Field("", validation_alias="ALIBABA_CLOUD_ACCESS_KEY_SECRET")
    oss_bucket: str = Field("", validation_alias="OSS_BUCKET")
    oss_region: str = Field("cn-beijing", validation_alias="OSS_REGION")
    oss_public_base_url: str = Field("", validation_alias="OSS_PUBLIC_BASE_URL")

    # Desktop project archive and cloud document parsing.
    project_archive_enabled: bool = Field(True, validation_alias="PROJECT_ARCHIVE_ENABLED")
    project_archive_upload_url_ttl_seconds: int = Field(
        3600,
        validation_alias="PROJECT_ARCHIVE_UPLOAD_URL_TTL_SECONDS",
        ge=300,
        le=86400,
    )
    project_archive_max_file_mb: int = Field(
        2048,
        validation_alias="PROJECT_ARCHIVE_MAX_FILE_MB",
        ge=1,
    )
    subagent_trace_archive_enabled: bool = Field(
        True,
        validation_alias="SUBAGENT_TRACE_ARCHIVE_ENABLED",
    )
    subagent_trace_upload_url_ttl_seconds: int = Field(
        3600,
        validation_alias="SUBAGENT_TRACE_UPLOAD_URL_TTL_SECONDS",
        ge=300,
        le=86400,
    )
    subagent_trace_max_file_mb: int = Field(
        128,
        validation_alias="SUBAGENT_TRACE_MAX_FILE_MB",
        ge=1,
        le=2048,
    )
    project_message_attachment_max_mb: int = Field(
        20,
        validation_alias="PROJECT_MESSAGE_ATTACHMENT_MAX_MB",
        ge=1,
        le=100,
    )
    project_document_cloud_enabled: bool = Field(
        True,
        validation_alias="PROJECT_DOCUMENT_CLOUD_ENABLED",
    )
    project_document_model: str = Field(
        "qwen-doc-turbo",
        validation_alias="PROJECT_DOCUMENT_MODEL",
    )
    project_document_fallback_model: str = Field(
        "qwen-long",
        validation_alias="PROJECT_DOCUMENT_FALLBACK_MODEL",
    )
    project_document_signed_url_ttl_seconds: int = Field(
        900,
        validation_alias="PROJECT_DOCUMENT_SIGNED_URL_TTL_SECONDS",
        ge=60,
        le=3600,
    )
    project_document_timeout_seconds: int = Field(
        600,
        validation_alias="PROJECT_DOCUMENT_TIMEOUT_SECONDS",
        ge=30,
    )
    project_document_max_concurrency: int = Field(
        32,
        validation_alias="PROJECT_DOCUMENT_MAX_CONCURRENCY",
        ge=1,
        le=256,
    )
    project_document_max_queue_depth: int = Field(
        64,
        validation_alias="PROJECT_DOCUMENT_MAX_QUEUE_DEPTH",
        ge=0,
        le=512,
    )
    project_document_queue_wait_seconds: float = Field(
        300.0,
        validation_alias="PROJECT_DOCUMENT_QUEUE_WAIT_SECONDS",
        ge=1,
        le=3600,
    )
    project_document_provider_max_attempts: int = Field(
        3,
        validation_alias="PROJECT_DOCUMENT_PROVIDER_MAX_ATTEMPTS",
        ge=1,
        le=10,
    )
    project_document_provider_retry_base_seconds: float = Field(
        2.0,
        validation_alias="PROJECT_DOCUMENT_PROVIDER_RETRY_BASE_SECONDS",
        ge=0.1,
        le=30,
    )
    project_document_pdf_vision_enabled: bool = Field(
        True,
        validation_alias="PROJECT_DOCUMENT_PDF_VISION_ENABLED",
    )
    project_document_pdf_vision_model: str = Field(
        "qwen3.8-max",
        validation_alias="PROJECT_DOCUMENT_PDF_VISION_MODEL",
    )
    project_document_max_output_tokens: int = Field(
        32768,
        validation_alias="PROJECT_DOCUMENT_MAX_OUTPUT_TOKENS",
        ge=1024,
        le=32768,
    )
    project_document_fallback_parse_timeout_seconds: int = Field(
        900,
        validation_alias="PROJECT_DOCUMENT_FALLBACK_PARSE_TIMEOUT_SECONDS",
        ge=60,
    )
    project_document_fallback_poll_interval_seconds: float = Field(
        2.0,
        validation_alias="PROJECT_DOCUMENT_FALLBACK_POLL_INTERVAL_SECONDS",
        ge=0.5,
        le=10,
    )
    project_document_max_file_mb: int = Field(
        150,
        validation_alias="PROJECT_DOCUMENT_MAX_FILE_MB",
        ge=1,
        le=150,
    )

    # Managed agent gateway models (company-side; clients use aliases only).
    agent_default_model: str = Field("qwen3.8-max", validation_alias="AGENT_DEFAULT_MODEL")
    agent_vision_model: str = Field("qwen3.8-max", validation_alias="AGENT_VISION_MODEL")
    agent_expert_model: str = Field("qwen3.8-max", validation_alias="AGENT_EXPERT_MODEL")
    # Context checkpoint summarization (desktop compaction). Defaults to agent_default_model.
    agent_compaction_model: str = Field("qwen3.8-max", validation_alias="AGENT_COMPACTION_MODEL")
    agent_default_context_window: int = Field(
        1_000_000,
        validation_alias="AGENT_DEFAULT_CONTEXT_WINDOW",
        ge=8_192,
    )
    agent_max_output_tokens: int = Field(
        65_536,
        validation_alias="AGENT_MAX_OUTPUT_TOKENS",
        ge=256,
    )
    agent_cad_query_max_output_tokens: int = Field(
        16_384,
        validation_alias="AGENT_CAD_QUERY_MAX_OUTPUT_TOKENS",
        ge=256,
    )
    agent_visual_index_max_output_tokens: int = Field(
        4_096,
        validation_alias="AGENT_VISUAL_INDEX_MAX_OUTPUT_TOKENS",
        ge=256,
    )
    agent_schema_repair_max_output_tokens: int = Field(
        8_192,
        validation_alias="AGENT_SCHEMA_REPAIR_MAX_OUTPUT_TOKENS",
        ge=256,
    )
    agent_compaction_max_output_tokens: int = Field(
        4_096,
        validation_alias="AGENT_COMPACTION_MAX_OUTPUT_TOKENS",
        ge=256,
    )
    agent_gateway_timeout_seconds: float = Field(
        120.0,
        validation_alias="AGENT_GATEWAY_TIMEOUT_SECONDS",
        ge=10,
    )
    agent_gateway_stream_read_timeout_seconds: float = Field(
        300.0,
        validation_alias="AGENT_GATEWAY_STREAM_READ_TIMEOUT_SECONDS",
        ge=10,
    )
    # cad_query / visual_index are intentionally allowed to run for about 30 minutes
    # in the desktop client. Keep the provider-side non-streaming request alive a
    # little longer so the gateway cannot become the earlier deadline.
    agent_gateway_cad_timeout_seconds: float = Field(
        2_100.0,
        validation_alias="AGENT_GATEWAY_CAD_TIMEOUT_SECONDS",
        ge=10,
    )
    # When true, /agent/v1/chat/completions requires an active agent-run binding
    # (api key form: xl.<client_run_id>.<access_jwt> or header X-Xiaoliang-Agent-Run-Id).
    agent_gateway_require_run_id: bool = Field(
        True,
        validation_alias="AGENT_GATEWAY_REQUIRE_RUN_ID",
    )

    # Credit billing. Credits are derived from real provider token usage:
    # credits = ceil(provider_cost_rmb * markup / 0.008).
    # 10/9 ≈ 1.111 keeps starter near 10% model-cost margin.
    billing_credit_markup: float = Field(
        BILLING_DEFAULT_CREDIT_MARKUP,
        validation_alias="BILLING_CREDIT_MARKUP",
        gt=0,
    )
    # Shadow mode: when false, charges are still recorded but never block a call.
    billing_credits_enforce: bool = Field(
        True,
        validation_alias="BILLING_CREDITS_ENFORCE",
    )
    billing_signup_grant_credits: int = Field(
        2_000,
        validation_alias="BILLING_SIGNUP_GRANT_CREDITS",
        ge=0,
    )
    billing_grant_duration_days: int = Field(
        365,
        validation_alias="BILLING_GRANT_DURATION_DAYS",
        ge=1,
    )

    # WeChat Native Pay (billing).
    wechatpay_app_id: str = Field("", validation_alias="WECHATPAY_APP_ID")
    wechatpay_mch_id: str = Field("", validation_alias="WECHATPAY_MCH_ID")
    wechatpay_cert_serial_no: str = Field("", validation_alias="WECHATPAY_CERT_SERIAL_NO")
    wechatpay_apiv3_key: str = Field("", validation_alias="WECHATPAY_APIV3_KEY")
    wechatpay_private_key_path: str = Field(
        "wechatpay_key/apiclient_key.pem",
        validation_alias="WECHATPAY_PRIVATE_KEY_PATH",
    )
    wechatpay_cert_dir: str = Field("wechatpay_key", validation_alias="WECHATPAY_CERT_DIR")
    wechatpay_notify_url: str = Field(
        "https://xl.x3yun.com/api/billing/wechat/native/notify",
        validation_alias="WECHATPAY_NOTIFY_URL",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> list[str]:
        if value is None:
            return ["*"]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        text = str(value).strip()
        if not text:
            return ["*"]
        if text == "*":
            return ["*"]
        return [item.strip() for item in text.split(",") if item.strip()]

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            _CsvListEnvSettingsSource(settings_cls),
            _CsvListDotEnvSettingsSource(settings_cls),
            file_secret_settings,
        )

    @field_validator("patient_asr_allowed_extensions", "patient_asr_allowed_mime_types", mode="before")
    @classmethod
    def parse_csv_list(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        text = str(value).strip()
        if not text:
            return []
        return [item.strip() for item in text.split(",") if item.strip()]

    @field_validator("tencent_template_id", mode="before")
    @classmethod
    def parse_tencent_template_id(cls, value: object) -> int:
        if value is None or value == "":
            return 0
        return int(value)

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        text = str(value or "").strip().lower()
        if text in {"1", "true", "yes", "on", "dev", "debug", "development"}:
            return True
        if text in {"0", "false", "no", "off", "prod", "production", "release", ""}:
            return False
        return False

    @model_validator(mode="after")
    def reject_wildcard_production_cors(self) -> "Settings":
        if (
            self.app_env.strip().lower() in {"prod", "production", "release"}
            and "*" in self.cors_origins
        ):
            raise ValueError(
                "CORS_ORIGINS must list explicit origins when APP_ENV is production."
            )
        return self

    @model_validator(mode="after")
    def reserve_workers_outside_document_analysis(self) -> "Settings":
        if not self.project_document_cloud_enabled:
            return self
        document_capacity = (
            self.project_document_max_concurrency
            + self.project_document_max_queue_depth
        )
        required_pool_size = document_capacity + SERVER_THREAD_POOL_RESERVED_TOKENS
        if self.server_thread_pool_size < required_pool_size:
            raise ValueError(
                "SERVER_THREAD_POOL_SIZE must be at least "
                "PROJECT_DOCUMENT_MAX_CONCURRENCY + PROJECT_DOCUMENT_MAX_QUEUE_DEPTH + "
                f"{SERVER_THREAD_POOL_RESERVED_TOKENS} reserved workers "
                f"(configured={self.server_thread_pool_size}, required={required_pool_size})."
            )
        return self

    @model_validator(mode="after")
    def reject_stale_production_credit_markup(self) -> "Settings":
        if self.app_env.strip().lower() not in {"prod", "production", "release"}:
            return self
        drift = abs(
            self.billing_credit_markup - BILLING_DEFAULT_CREDIT_MARKUP
        ) / BILLING_DEFAULT_CREDIT_MARKUP
        if drift > BILLING_CREDIT_MARKUP_MAX_DRIFT_RATIO:
            raise ValueError(
                "BILLING_CREDIT_MARKUP does not match the deployed credit catalog: "
                f"configured={self.billing_credit_markup:g}, "
                f"expected≈{BILLING_DEFAULT_CREDIT_MARKUP:.6f}. "
                "Update the production .env and restart the service."
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
