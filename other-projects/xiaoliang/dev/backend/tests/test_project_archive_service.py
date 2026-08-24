from __future__ import annotations

import hashlib
import io
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.schemas  # noqa: F401
from app.core.config import Settings, get_settings
from app.core.database import Base
from app.core.errors import AppError
from app.models.project_archive import (
    ProjectArchiveConversationSyncRequest,
    ProjectArchiveFilesConfirmRequest,
    ProjectArchiveUpsertRequest,
    PiSessionArchivePrepareRequest,
    ProjectDocumentAnalyzeRequest,
)
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.repositories.project_archive_repository import ProjectArchiveRepository
from app.schemas.organization import Organization
from app.schemas.project_archive import (
    ProjectArchive,
    ProjectArchiveConversation,
    ProjectArchiveFile,
    ProjectArchiveMessage,
    PiSessionArchive,
    ProjectDocumentAnalysis,
)
from app.schemas.user import User
from app.services.project_archive_service import (
    PROVIDER_KIND_PERMANENT,
    PROVIDER_KIND_THROTTLED,
    PROVIDER_KIND_TRANSIENT,
    DocumentProviderError,
    ProjectArchiveService,
    _classify_provider_error,
    _consume_openai_stream,
    _document_analysis_admission_limiter,
    _document_analysis_limiter,
    _provider_error,
    _provider_http_failure,
)


class _FakeBucket:
    def __init__(self, data: bytes, sha256: str | None) -> None:
        self.data = data
        self.sha256 = sha256

    def head_object(self, _storage_key: str):
        headers = {"x-oss-meta-sha256": self.sha256} if self.sha256 else {}
        return SimpleNamespace(content_length=len(self.data), headers=headers)

    def get_object(self, _storage_key: str):
        return io.BytesIO(self.data)


class ProjectArchiveServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.SessionLocal = sessionmaker(
            bind=self.engine,
            autoflush=False,
            autocommit=False,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.session = self.SessionLocal()
        self.organization = Organization(name="Test Org", slug="project-archive-test")
        self.owner = User(
            email="archive-owner@example.com",
            password_hash="hashed",
            display_name="Owner",
        )
        self.other_user = User(
            email="archive-other@example.com",
            password_hash="hashed",
            display_name="Other",
        )
        self.session.add_all([self.organization, self.owner, self.other_user])
        self.session.commit()
        self.owner_context = self._current_user(self.owner)
        self.other_context = self._current_user(self.other_user)
        self.settings = get_settings().model_copy(
            update={
                "project_archive_enabled": True,
                "project_document_cloud_enabled": True,
                "project_document_max_concurrency": 1,
                "project_document_model": "qwen-doc-test",
                "project_document_fallback_model": "qwen-long-test",
                "project_document_pdf_vision_enabled": True,
                "project_document_pdf_vision_model": "qwen-pdf-test",
                "project_document_provider_max_attempts": 2,
                "project_document_provider_retry_base_seconds": 0.01,
            }
        )
        _document_analysis_limiter.cache_clear()
        _document_analysis_admission_limiter.cache_clear()

    def tearDown(self) -> None:
        _document_analysis_limiter.cache_clear()
        _document_analysis_admission_limiter.cache_clear()
        self.session.close()
        self.engine.dispose()

    def _current_user(self, user: User) -> CurrentUserData:
        return CurrentUserData(
            user=UserView.model_validate(user),
            organization=OrganizationView.model_validate(self.organization),
            role="member",
        )

    @staticmethod
    def _project_request() -> ProjectArchiveUpsertRequest:
        return ProjectArchiveUpsertRequest(
            local_project_id="local-project-1",
            name="Project",
            description="",
        )

    def _seed_project_file(self, *, data: bytes, extension: str = ".pdf") -> tuple[ProjectArchive, ProjectArchiveFile]:
        service = ProjectArchiveService(self.settings, self.session)
        service.upsert_project(self.owner_context, self._project_request())
        project = self.session.scalar(select(ProjectArchive))
        assert project is not None
        sha256 = hashlib.sha256(data).hexdigest()
        project_file = ProjectArchiveFile(
            project_archive_id=project.id,
            archived_by_user_id=self.owner.id,
            relative_path=f"docs/file{extension}",
            normalized_path=f"docs/file{extension}",
            filename=f"file{extension}",
            extension=extension,
            media_type="application/pdf",
            size_bytes=len(data),
            sha256=sha256,
            storage_key=f"project-archives/{self.organization.id}/{project.id}/files/{sha256}",
            upload_status="pending",
            is_deleted=False,
        )
        self.session.add(project_file)
        self.session.commit()
        return project, project_file

    def test_project_archive_is_owner_scoped_inside_organization(self) -> None:
        service = ProjectArchiveService(self.settings, self.session)
        service.upsert_project(self.owner_context, self._project_request())

        with self.assertRaises(AppError) as raised:
            service.upsert_project(self.other_context, self._project_request())

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(raised.exception.error_code, "project_archive_forbidden")
        project = self.session.scalar(select(ProjectArchive))
        self.assertEqual(project.owner_user_id, self.owner.id)

    def test_confirm_rejects_matching_metadata_when_object_bytes_do_not_match(self) -> None:
        expected_data = b"safe"
        project, project_file = self._seed_project_file(data=expected_data)
        project_file_id = project_file.id
        wrong_data = b"evil"
        service = ProjectArchiveService(self.settings, self.session)
        service._bucket = lambda: _FakeBucket(wrong_data, project_file.sha256)  # type: ignore[method-assign]

        result = service.confirm_files(
            self.owner_context,
            ProjectArchiveFilesConfirmRequest.model_validate(
                {
                    "local_project_id": project.local_project_id,
                    "files": [
                        {
                            "relative_path": project_file.relative_path,
                            "sha256": project_file.sha256,
                        }
                    ],
                }
            ),
        )

        self.assertEqual(result.results[0].status, "mismatch")
        self.assertIn("实际内容", result.results[0].error or "")
        refreshed = self.session.get(ProjectArchiveFile, project_file_id)
        self.assertEqual(refreshed.upload_status, "failed")

    def test_confirm_rejects_missing_sha256_metadata(self) -> None:
        data = b"safe"
        project, project_file = self._seed_project_file(data=data)
        service = ProjectArchiveService(self.settings, self.session)
        service._bucket = lambda: _FakeBucket(data, None)  # type: ignore[method-assign]

        result = service.confirm_files(
            self.owner_context,
            ProjectArchiveFilesConfirmRequest.model_validate(
                {
                    "local_project_id": project.local_project_id,
                    "files": [
                        {
                            "relative_path": project_file.relative_path,
                            "sha256": project_file.sha256,
                        }
                    ],
                }
            ),
        )

        self.assertEqual(result.results[0].status, "mismatch")
        self.assertIn("缺少 SHA-256", result.results[0].error or "")

    def test_ready_status_is_not_inherited_by_an_unverified_duplicate(self) -> None:
        data = b"duplicate content"
        project, first = self._seed_project_file(data=data)
        repository = ProjectArchiveRepository(self.session)
        repository.mark_file_ready(first)
        self.session.commit()

        duplicate = repository.upsert_file(
            project_archive_id=project.id,
            user_id=self.owner.id,
            relative_path="docs/copy.pdf",
            normalized_path="docs/copy.pdf",
            filename="copy.pdf",
            extension=".pdf",
            media_type="application/pdf",
            size_bytes=len(data),
            sha256=first.sha256,
            modified_at_client=None,
            storage_key=first.storage_key or "",
            snapshot_id=None,
        )

        self.assertEqual(duplicate.upload_status, "pending")
        scoped_key = ProjectArchiveService(self.settings, self.session)._project_file_storage_key(
            self.organization.id,
            project.id,
            first.sha256,
            ".pdf",
        )
        self.assertTrue(scoped_key.startswith(f"project-archives/{self.organization.id}/"))

    def test_document_provider_io_runs_without_an_open_db_transaction(self) -> None:
        data = b"archived pdf"
        project, project_file = self._seed_project_file(data=data)
        project_file.upload_status = "ready"
        self.session.commit()
        service = ProjectArchiveService(self.settings, self.session)
        service._sign_get_url = lambda _key: "https://example.invalid/file.pdf"  # type: ignore[method-assign]

        def fake_analyze(**_kwargs):
            self.assertFalse(self.session.in_transaction())
            return "document content", {"input_tokens": 10}

        service._analyze_with_qwen_doc = fake_analyze  # type: ignore[method-assign]
        result = service.analyze_document(
            self.owner_context,
            ProjectDocumentAnalyzeRequest(
                local_project_id=project.local_project_id,
                relative_path=project_file.relative_path,
                sha256=project_file.sha256,
                instruction="read it",
            ),
        )

        self.assertEqual(result.content, "document content")
        self.assertFalse(result.cached)
        analysis = self.session.scalar(select(ProjectDocumentAnalysis))
        self.assertEqual(analysis.status, "completed")

    def _ready_pdf_request(self) -> ProjectDocumentAnalyzeRequest:
        data = b"archived pdf"
        project, project_file = self._seed_project_file(data=data)
        project_file.upload_status = "ready"
        self.session.commit()
        return ProjectDocumentAnalyzeRequest(
            local_project_id=project.local_project_id,
            relative_path=project_file.relative_path,
            sha256=project_file.sha256,
            instruction="read it",
        )

    def _document_service(self, settings=None) -> ProjectArchiveService:
        service = ProjectArchiveService(settings or self.settings, self.session)
        service._sign_get_url = lambda _key: "https://example.invalid/file.pdf"  # type: ignore[method-assign]
        return service

    def test_document_analysis_queues_instead_of_rejecting_when_slots_are_busy(self) -> None:
        request = self._ready_pdf_request()
        service = self._document_service()
        service._analyze_with_qwen_doc = lambda **_kwargs: ("queued content", None)  # type: ignore[method-assign]

        limiter = _document_analysis_limiter(1)
        self.assertTrue(limiter.acquire(blocking=False))
        release_delay = 0.3
        releaser = threading.Timer(release_delay, limiter.release)
        started = time.monotonic()
        releaser.start()
        try:
            result = service.analyze_document(self.owner_context, request)
        finally:
            releaser.cancel()
        elapsed = time.monotonic() - started

        self.assertEqual(result.content, "queued content")
        self.assertGreaterEqual(elapsed, release_delay - 0.05)

    def test_queue_waiter_reuses_analysis_completed_while_waiting(self) -> None:
        request = self._ready_pdf_request()
        service = self._document_service()
        cached = SimpleNamespace(
            status="pending",
            model=None,
            fallback_used=False,
            content="",
            truncated=False,
            warnings_json=None,
            usage_json=None,
        )
        lookups = 0

        def get_analysis(_project_file_id: str, _fingerprint: str):
            nonlocal lookups
            lookups += 1
            return cached

        service.repository.get_analysis = get_analysis  # type: ignore[method-assign]
        service._analyze_with_qwen_doc = lambda **_kwargs: (_ for _ in ()).throw(  # type: ignore[method-assign]
            AssertionError("a completed queued result must not call the provider again")
        )

        test_case = self

        class CompletingLimiter:
            releases = 0

            def acquire(self, blocking: bool = True, timeout: float | None = None) -> bool:
                del timeout
                if not blocking:
                    return False
                test_case.assertFalse(
                    test_case.session.in_transaction(),
                    "queue wait must not retain a database transaction",
                )
                cached.status = "completed"
                cached.model = "qwen-doc-test"
                cached.content = "winner content"
                cached.usage_json = '{"total_tokens":9}'
                return True

            def release(self) -> None:
                self.releases += 1

        limiter = CompletingLimiter()
        with patch(
            "app.services.project_archive_service._document_analysis_limiter",
            return_value=limiter,
        ):
            result = service.analyze_document(self.owner_context, request)

        self.assertTrue(result.cached)
        self.assertEqual(result.content, "winner content")
        self.assertEqual(result.usage, {"total_tokens": 9})
        self.assertEqual(lookups, 2)
        self.assertEqual(limiter.releases, 1)

    def test_queue_timeout_does_not_blame_the_cloud_provider(self) -> None:
        request = self._ready_pdf_request()
        settings = self.settings.model_copy(
            update={"project_document_queue_wait_seconds": 1.0}
        )
        limiter = _document_analysis_limiter(1)
        self.assertTrue(limiter.acquire(blocking=False))
        try:
            with self.assertRaises(AppError) as raised:
                self._document_service(settings).analyze_document(
                    self.owner_context, request
                )
        finally:
            limiter.release()

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.error_code, "project_document_queue_timeout")
        self.assertIn("排队等待", raised.exception.message)
        self.assertNotIn("繁忙", raised.exception.message)

    def test_document_queue_depth_caps_sync_worker_waiters(self) -> None:
        request = self._ready_pdf_request()
        settings = self.settings.model_copy(
            update={"project_document_max_queue_depth": 1}
        )
        admission = _document_analysis_admission_limiter(1, 1)
        self.assertTrue(admission.acquire(blocking=False))
        self.assertTrue(admission.acquire(blocking=False))
        try:
            with self.assertRaises(AppError) as raised:
                self._document_service(settings).analyze_document(
                    self.owner_context, request
                )
        finally:
            admission.release()
            admission.release()

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.error_code, "project_document_queue_full")
        self.assertIn("本地队列已满", raised.exception.message)

    def test_settings_reserve_general_workers_outside_document_queue(self) -> None:
        with self.assertRaises(ValidationError) as raised:
            Settings(
                _env_file=None,
                APP_ENV="development",
                SERVER_THREAD_POOL_SIZE=80,
                PROJECT_DOCUMENT_CLOUD_ENABLED=True,
                PROJECT_DOCUMENT_MAX_CONCURRENCY=32,
                PROJECT_DOCUMENT_MAX_QUEUE_DEPTH=16,
            )

        self.assertIn("40 reserved workers", str(raised.exception))

    def test_pdf_vision_leg_takes_over_when_qwen_doc_is_throttled(self) -> None:
        request = self._ready_pdf_request()
        service = self._document_service()
        doc_calls = 0
        vision_calls = 0

        def throttled_doc(**_kwargs):
            nonlocal doc_calls
            doc_calls += 1
            raise _provider_error(
                "qwen-doc-test",
                PROVIDER_KIND_THROTTLED,
                "Requests rate limit exceeded",
                status=429,
                code="Throttling.RateQuota",
            )

        def vision(**_kwargs):
            nonlocal vision_calls
            vision_calls += 1
            return "vision content", {"total_tokens": 42}

        service._analyze_with_qwen_doc = throttled_doc  # type: ignore[method-assign]
        service._analyze_with_pdf_vision = vision  # type: ignore[method-assign]

        result = service.analyze_document(self.owner_context, request)

        self.assertEqual(result.content, "vision content")
        self.assertEqual(result.model, "qwen-pdf-test")
        self.assertTrue(result.fallback_used)
        self.assertEqual(doc_calls, 2, "throttled legs must be retried before falling back")
        self.assertEqual(vision_calls, 1)
        self.assertTrue(
            any("Throttling.RateQuota" in warning for warning in result.warnings),
            result.warnings,
        )

    def test_pdf_vision_configuration_participates_in_the_cache_fingerprint(self) -> None:
        request = self._ready_pdf_request()

        def unavailable_doc(**_kwargs):
            raise _provider_error(
                "qwen-doc-test", PROVIDER_KIND_PERMANENT, "primary unavailable"
            )

        first = self._document_service()
        first._analyze_with_qwen_doc = unavailable_doc  # type: ignore[method-assign]
        first._analyze_with_pdf_vision = lambda **_kwargs: ("vision v1", None)  # type: ignore[method-assign]
        first_result = first.analyze_document(self.owner_context, request)

        changed_model_settings = self.settings.model_copy(
            update={"project_document_pdf_vision_model": "qwen-pdf-v2"}
        )
        second = self._document_service(changed_model_settings)
        second._analyze_with_qwen_doc = unavailable_doc  # type: ignore[method-assign]
        second._analyze_with_pdf_vision = lambda **_kwargs: ("vision v2", None)  # type: ignore[method-assign]
        second_result = second.analyze_document(self.owner_context, request)

        disabled_settings = changed_model_settings.model_copy(
            update={"project_document_pdf_vision_enabled": False}
        )
        third = self._document_service(disabled_settings)
        third._analyze_with_qwen_doc = unavailable_doc  # type: ignore[method-assign]
        third._analyze_with_pdf_vision = lambda **_kwargs: (_ for _ in ()).throw(  # type: ignore[method-assign]
            AssertionError("disabled vision leg must not run")
        )
        third._analyze_with_qwen_long = lambda **_kwargs: ("long fallback", None)  # type: ignore[method-assign]
        third_result = third.analyze_document(self.owner_context, request)

        self.assertFalse(first_result.cached)
        self.assertFalse(second_result.cached)
        self.assertFalse(third_result.cached)
        self.assertEqual(second_result.model, "qwen-pdf-v2")
        self.assertEqual(second_result.content, "vision v2")
        self.assertEqual(third_result.content, "long fallback")
        analyses = self.session.scalars(select(ProjectDocumentAnalysis)).all()
        self.assertEqual(len(analyses), 3)

    def test_failed_attempt_does_not_overwrite_a_completed_analysis(self) -> None:
        request = self._ready_pdf_request()
        project_file = self.session.scalar(select(ProjectArchiveFile))
        assert project_file is not None
        repository = ProjectArchiveRepository(self.session)
        fingerprint = "f" * 64
        analysis = repository.upsert_analysis(
            project_file_id=project_file.id,
            user_id=self.owner.id,
            fingerprint=fingerprint,
            instruction=request.instruction or "read it",
            parsing_strategy=request.file_parsing_strategy,
        )
        repository.finish_analysis(
            analysis,
            model="winner-model",
            fallback_used=False,
            content="winner content",
            truncated=False,
            warnings_json="[]",
            usage_json=None,
        )
        self.session.commit()

        changed = repository.fail_analysis(
            project_file_id=project_file.id,
            fingerprint=fingerprint,
            error="late loser",
        )
        self.session.commit()
        self.session.expire_all()

        preserved = repository.get_analysis(project_file.id, fingerprint)
        assert preserved is not None
        self.assertFalse(changed)
        self.assertEqual(preserved.status, "completed")
        self.assertEqual(preserved.content, "winner content")
        self.assertIsNone(preserved.error_message)

    def test_provider_throttling_is_only_reported_when_every_leg_is_throttled(self) -> None:
        request = self._ready_pdf_request()
        service = self._document_service()

        def throttled(leg: str, retry_after: float | None):
            def call(**_kwargs):
                raise _provider_error(
                    leg,
                    PROVIDER_KIND_THROTTLED,
                    "Requests rate limit exceeded",
                    status=429,
                    code="Throttling.RateQuota",
                    retry_after=retry_after,
                )

            return call

        service._analyze_with_qwen_doc = throttled("qwen-doc-test", 3.0)  # type: ignore[method-assign]
        service._analyze_with_pdf_vision = throttled("qwen-pdf-test", 7.0)  # type: ignore[method-assign]
        service._analyze_with_qwen_long = throttled("qwen-long-test", None)  # type: ignore[method-assign]

        with self.assertRaises(AppError) as raised:
            service.analyze_document(self.owner_context, request)

        error = raised.exception
        self.assertEqual(error.status_code, 429)
        self.assertEqual(error.error_code, "project_document_provider_throttled")
        self.assertIn("限流", error.message)
        self.assertEqual(error.details["retry_after_seconds"], 7.0)
        self.assertEqual(
            [leg["leg"] for leg in error.details["legs"]],
            ["qwen-doc-test", "qwen-pdf-test", "qwen-long-test"],
        )

    def test_permanent_provider_errors_are_not_retried_and_report_real_reasons(self) -> None:
        request = self._ready_pdf_request()
        service = self._document_service()
        calls: list[str] = []

        def permanent(leg: str, message: str, code: str):
            def call(**_kwargs):
                calls.append(leg)
                raise _provider_error(
                    leg,
                    PROVIDER_KIND_PERMANENT,
                    message,
                    status=400,
                    code=code,
                )

            return call

        service._analyze_with_qwen_doc = permanent(  # type: ignore[method-assign]
            "qwen-doc-test", "参数不合法", "InvalidParameter"
        )
        service._analyze_with_pdf_vision = permanent(  # type: ignore[method-assign]
            "qwen-pdf-test", "文档超过 500 页", "InvalidParameter.PageLimit"
        )
        service._analyze_with_qwen_long = permanent(  # type: ignore[method-assign]
            "qwen-long-test", "文件类型不支持", "InvalidFile"
        )

        with self.assertRaises(AppError) as raised:
            service.analyze_document(self.owner_context, request)

        error = raised.exception
        self.assertEqual(error.status_code, 502)
        self.assertEqual(error.error_code, "project_document_analysis_failed")
        self.assertNotIn("限流", error.message)
        self.assertIn("InvalidParameter", error.message)
        self.assertIn("文档超过 500 页", error.message)
        self.assertEqual(
            calls, ["qwen-doc-test", "qwen-pdf-test", "qwen-long-test"],
            "permanent failures must not be retried",
        )

    def test_pdf_vision_leg_is_skipped_when_disabled(self) -> None:
        request = self._ready_pdf_request()
        settings = self.settings.model_copy(
            update={"project_document_pdf_vision_enabled": False}
        )
        service = self._document_service(settings)

        def failing_doc(**_kwargs):
            raise _provider_error(
                "qwen-doc-test", PROVIDER_KIND_PERMANENT, "参数不合法"
            )

        def unexpected_vision(**_kwargs):
            raise AssertionError("disabled PDF vision leg must not run")

        service._analyze_with_qwen_doc = failing_doc  # type: ignore[method-assign]
        service._analyze_with_pdf_vision = unexpected_vision  # type: ignore[method-assign]
        service._analyze_with_qwen_long = lambda **_kwargs: ("long content", None)  # type: ignore[method-assign]

        result = service.analyze_document(self.owner_context, request)

        self.assertEqual(result.content, "long content")
        self.assertEqual(result.model, "qwen-long-test")

    def test_streaming_pdf_response_is_concatenated_with_usage(self) -> None:
        lines = [
            ": keep-alive",
            "",
            'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
            'data: {"choices":[{"delta":{"content":"# 标题"}}]}',
            'data: {"choices":[{"delta":{"content":"\\n正文"}}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":11,"total_tokens":13}}',
            "data: [DONE]",
        ]

        content, usage = _consume_openai_stream("qwen-pdf-test", iter(lines))

        self.assertEqual(content, "# 标题\n正文")
        self.assertEqual(usage, {"prompt_tokens": 11, "total_tokens": 13})

    def test_pdf_vision_requests_low_effort_reasoning(self) -> None:
        response = MagicMock()
        response.status_code = 200
        response.__enter__.return_value = response
        response.iter_lines.return_value = iter(
            [
                'data: {"choices":[{"delta":{"reasoning_content":"提取文字"}}]}',
                'data: {"choices":[{"delta":{"content":"正文"}}]}',
                "data: [DONE]",
            ]
        )
        client = MagicMock()
        client.__enter__.return_value = client
        client.stream.return_value = response
        service = self._document_service()

        with patch(
            "app.services.project_archive_service.httpx.Client",
            return_value=client,
        ):
            content, _usage = service._analyze_with_pdf_vision(
                doc_url="https://example.invalid/file.pdf",
                instruction="提取正文",
            )

        request_body = client.stream.call_args.kwargs["json"]
        self.assertEqual(content, "正文")
        self.assertIs(request_body["enable_thinking"], True)
        self.assertEqual(request_body["reasoning_effort"], "low")

    def test_reasoning_only_pdf_stream_falls_through_as_empty_content(self) -> None:
        lines = [
            'data: {"choices":[{"delta":{"reasoning_content":"正在读取页面"}}]}',
            'data: {"choices":[{"delta":{"reasoning_content":"继续提取"}}]}',
            'data: {"choices":[],"usage":{"completion_tokens":32}}',
            "data: [DONE]",
        ]

        with self.assertRaises(DocumentProviderError) as raised:
            _consume_openai_stream("qwen-pdf-test", iter(lines))

        self.assertEqual(raised.exception.failure.kind, PROVIDER_KIND_TRANSIENT)
        self.assertIn("未返回任何内容", raised.exception.failure.message)

    def test_streaming_error_event_is_classified_as_throttling(self) -> None:
        lines = [
            'data: {"error":{"code":"rate_limit_exceeded","message":"too many requests"}}',
        ]

        with self.assertRaises(Exception) as raised:
            _consume_openai_stream("qwen-pdf-test", iter(lines))

        self.assertEqual(raised.exception.failure.kind, PROVIDER_KIND_THROTTLED)

    def test_http_429_becomes_a_retryable_throttled_failure_with_retry_after(self) -> None:
        response = SimpleNamespace(
            status_code=429,
            headers={"retry-after": "12"},
            text='{"code":"Throttling.RateQuota","message":"rate limit"}',
        )

        failure = _provider_http_failure("qwen-doc-test", response).failure

        self.assertEqual(failure.kind, PROVIDER_KIND_THROTTLED)
        self.assertEqual(failure.code, "Throttling.RateQuota")
        self.assertEqual(failure.retry_after, 12.0)
        self.assertTrue(failure.retryable)

    def test_client_errors_are_permanent_but_server_errors_are_transient(self) -> None:
        self.assertEqual(
            _classify_provider_error(400, "InvalidParameter", "bad request"),
            PROVIDER_KIND_PERMANENT,
        )
        self.assertEqual(
            _classify_provider_error(503, "", "upstream unavailable"), "transient"
        )
        self.assertEqual(
            _classify_provider_error(400, "insufficient_quota", "余额不足"), "quota"
        )
        self.assertEqual(
            _classify_provider_error(429, "insufficient_quota", "余额不足"), "quota"
        )
        self.assertEqual(
            _classify_provider_error(429, "QuotaExceeded", "quota exhausted"), "quota"
        )

    def test_conversation_payload_has_aggregate_size_limit(self) -> None:
        large_text = "x" * 1_000_000
        messages = [
            {
                "id": f"message-{index}",
                "source_key": f"{index:064x}",
                "role": "assistant",
                "content": large_text,
            }
            for index in range(9)
        ]

        with self.assertRaises(ValidationError):
            ProjectArchiveConversationSyncRequest.model_validate(
                {
                    "local_project_id": "local-project-1",
                    "name": "Project",
                    "description": "",
                    "conversation": {
                        "id": "conversation-1",
                        "messages": messages,
                    },
                }
            )

    def test_conversation_sync_persists_creation_source_and_active_path_scope(self) -> None:
        service = ProjectArchiveService(self.settings, self.session)
        service.sync_conversation(
            self.owner_context,
            ProjectArchiveConversationSyncRequest.model_validate(
                {
                    "local_project_id": "local-project-1",
                    "name": "Project",
                    "description": "",
                    "conversation": {
                        "id": "conversation-1",
                        "title": "核对门窗表",
                        "creation_source": "desktop_tree_branch",
                        "session_sync_scope": "active_path",
                        "parent_conversation_id": "conversation-parent",
                        "forked_from_entry_id": "entry-branch-point",
                        "messages": [],
                    },
                }
            ),
        )

        conversation = self.session.scalar(select(ProjectArchiveConversation))
        assert conversation is not None
        self.assertEqual(conversation.creation_source, "desktop_tree_branch")
        self.assertEqual(conversation.session_sync_scope, "active_path")
        self.assertEqual(
            conversation.parent_local_conversation_id,
            "conversation-parent",
        )
        self.assertEqual(conversation.forked_from_entry_id, "entry-branch-point")

    def test_pi_session_archives_keep_raw_jsonl_versions_and_message_links(self) -> None:
        service = ProjectArchiveService(self.settings, self.session)
        service.sync_conversation(
            self.owner_context,
            ProjectArchiveConversationSyncRequest.model_validate(
                {
                    "local_project_id": "local-project-1",
                    "name": "Project",
                    "description": "",
                    "conversation": {
                        "id": "conversation-1",
                        "messages": [
                            {
                                "id": "pi:session-1:entry-1",
                                "client_run_id": "run-1",
                                "pi_session_id": "session-1",
                                "pi_entry_id": "entry-1",
                                "source_key": "1" * 64,
                                "role": "user",
                                "content": "检查图纸",
                            }
                        ],
                    },
                }
            ),
        )
        service._sign_url = lambda **_kwargs: "https://signed.invalid/pi-session"  # type: ignore[method-assign]

        payloads: list[PiSessionArchivePrepareRequest] = []
        for entry_count in (1, 2):
            data = (
                '{"type":"session","version":3,"id":"session-1"}\n'
                + "\n".join(
                    f'{{"type":"message","id":"entry-{index + 1}","parentId":null}}'
                    for index in range(entry_count)
                )
                + "\n"
            ).encode()
            payload = PiSessionArchivePrepareRequest(
                local_project_id="local-project-1",
                name="Project",
                description="",
                local_conversation_id="conversation-1",
                pi_session_id="session-1",
                runtime_version=2,
                jsonl_schema_version=3,
                current_leaf_entry_id=f"entry-{entry_count}",
                entry_count=entry_count,
                sha256=hashlib.sha256(data).hexdigest(),
                size_bytes=len(data),
                source_modified_at=f"2026-08-12T10:0{entry_count}:00Z",
            )
            payloads.append(payload)
            prepared = service.prepare_pi_session_archive(self.owner_context, payload)
            self.assertTrue(prepared.upload_required)
            self.assertTrue(prepared.storage_key.endswith(f"{payload.sha256}.jsonl"))

        archives = list(self.session.scalars(select(PiSessionArchive)))
        self.assertEqual(len(archives), 2)
        self.assertEqual({archive.entry_count for archive in archives}, {1, 2})
        self.assertEqual({archive.sha256 for archive in archives}, {item.sha256 for item in payloads})
        self.assertTrue(all(not archive.training_consent for archive in archives))

        message = self.session.scalar(select(ProjectArchiveMessage))
        assert message is not None
        self.assertEqual(message.client_run_id, "run-1")
        self.assertEqual(message.pi_session_id, "session-1")
        self.assertEqual(message.pi_entry_id, "entry-1")


if __name__ == "__main__":
    unittest.main()
