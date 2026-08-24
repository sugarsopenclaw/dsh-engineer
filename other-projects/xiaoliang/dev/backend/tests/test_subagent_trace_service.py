from __future__ import annotations

import hashlib
import io
import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.schemas  # noqa: F401
import app.services.subagent_trace_service as trace_service_module
from app.core.config import get_settings
from app.core.database import Base
from app.core.errors import AppError
from app.models.subagent_trace import (
    SubagentTraceConfirmRequest,
    SubagentTracePrepareRequest,
)
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.schemas.organization import Organization
from app.schemas.subagent_trace import SubagentTraceArchive, SubagentTraceBlobArchive
from app.schemas.user import User
from app.services.subagent_trace_service import SubagentTraceService


class _FakeBucket:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def sign_url(self, method: str, storage_key: str, _expires: int, **_kwargs):
        return f"https://signed.invalid/{method.lower()}/{storage_key}"

    def head_object(self, storage_key: str):
        if storage_key not in self.objects:
            error = RuntimeError("missing")
            error.status = 404  # type: ignore[attr-defined]
            raise error
        data, sha256 = self.objects[storage_key]
        return SimpleNamespace(
            content_length=len(data),
            headers={"x-oss-meta-sha256": sha256},
        )

    def get_object(self, storage_key: str):
        return io.BytesIO(self.objects[storage_key][0])


class SubagentTraceServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.SessionLocal = sessionmaker(bind=self.engine, future=True)
        Base.metadata.create_all(self.engine)
        self.session = self.SessionLocal()
        self.organization = Organization(name="Trace Org", slug="trace-org")
        self.user = User(email="trace@example.com", password_hash="hashed", display_name="Trace")
        self.session.add_all([self.organization, self.user])
        self.session.commit()
        self.current_user = CurrentUserData(
            user=UserView.model_validate(self.user),
            organization=OrganizationView.model_validate(self.organization),
            role="member",
        )
        self.settings = get_settings().model_copy(
            update={
                "subagent_trace_archive_enabled": True,
                "subagent_trace_max_file_mb": 8,
                "subagent_trace_upload_url_ttl_seconds": 900,
            }
        )
        self.bucket = _FakeBucket()
        self.original_has_credentials = trace_service_module.has_oss_credentials
        self.original_get_bucket = trace_service_module.get_oss_bucket
        trace_service_module.has_oss_credentials = lambda _settings=None: True
        trace_service_module.get_oss_bucket = lambda _settings=None: self.bucket

    def tearDown(self) -> None:
        trace_service_module.has_oss_credentials = self.original_has_credentials
        trace_service_module.get_oss_bucket = self.original_get_bucket
        self.session.close()
        self.engine.dispose()

    def _prepare_request(self, trace: bytes, screenshot: bytes) -> SubagentTracePrepareRequest:
        return SubagentTracePrepareRequest(
            local_project_id="local-project",
            project_name="Trace Project",
            child_run_id="child-run-1",
            parent_session_id="conversation-1",
            parent_prompt_id="prompt-1",
            parent_pi_session_id="pi-session-1",
            parent_pi_entry_id="pi-entry-1",
            client_run_id="client-1",
            agent_type="cad-analyst",
            status="completed",
            model="qwen3.8-max",
            started_at="2026-08-11T10:00:00Z",
            finished_at="2026-08-11T10:01:00Z",
            usage={"input": 10, "output": 5, "total": 15},
            tool_call_count=1,
            trace_schema_version=2,
            event_count=9,
            trace_sha256=hashlib.sha256(trace).hexdigest(),
            trace_size_bytes=len(trace),
            blobs=[{
                "sha256": hashlib.sha256(screenshot).hexdigest(),
                "size_bytes": len(screenshot),
                "mime_type": "image/png",
            }],
        )

    def test_prepare_and_confirm_trace_and_blob_with_content_verification(self) -> None:
        trace = b'{"type":"run_started"}\n{"type":"run_finished"}\n'
        screenshot = b"png-screenshot-bytes"
        service = SubagentTraceService(self.settings, self.session)
        prepared = service.prepare(self.current_user, self._prepare_request(trace, screenshot))

        self.assertTrue(prepared.upload_required)
        self.assertTrue(prepared.storage_key.endswith(".jsonl"))
        self.assertEqual(prepared.required_headers["Content-Type"], "application/x-ndjson")
        self.assertEqual(len(prepared.blob_targets), 1)
        self.assertFalse(
            self.session.scalar(select(SubagentTraceArchive)).training_consent  # type: ignore[union-attr]
        )
        stored = self.session.scalar(select(SubagentTraceArchive))
        self.assertEqual(stored.parent_pi_session_id, "pi-session-1")  # type: ignore[union-attr]
        self.assertEqual(stored.parent_pi_entry_id, "pi-entry-1")  # type: ignore[union-attr]
        self.bucket.objects[prepared.storage_key] = (trace, hashlib.sha256(trace).hexdigest())
        blob_target = prepared.blob_targets[0]
        self.bucket.objects[blob_target.storage_key] = (
            screenshot,
            hashlib.sha256(screenshot).hexdigest(),
        )

        confirmed = service.confirm(
            self.current_user,
            SubagentTraceConfirmRequest(
                local_project_id="local-project",
                child_run_id="child-run-1",
                trace_sha256=hashlib.sha256(trace).hexdigest(),
                blob_sha256s=[hashlib.sha256(screenshot).hexdigest()],
            ),
        )

        self.assertEqual(confirmed.status, "ready")
        self.assertEqual(confirmed.blobs[0].status, "ready")
        self.assertEqual(self.session.scalar(select(SubagentTraceArchive)).upload_status, "ready")  # type: ignore[union-attr]
        self.assertEqual(self.session.scalar(select(SubagentTraceBlobArchive)).upload_status, "ready")  # type: ignore[union-attr]

    def test_confirm_rejects_object_with_matching_metadata_but_wrong_bytes(self) -> None:
        trace = b"expected-trace"
        screenshot = b"expected-image"
        service = SubagentTraceService(self.settings, self.session)
        prepared = service.prepare(self.current_user, self._prepare_request(trace, screenshot))
        self.bucket.objects[prepared.storage_key] = (
            b"tampered-trace",
            hashlib.sha256(trace).hexdigest(),
        )

        confirmed = service.confirm(
            self.current_user,
            SubagentTraceConfirmRequest(
                local_project_id="local-project",
                child_run_id="child-run-1",
                trace_sha256=hashlib.sha256(trace).hexdigest(),
            ),
        )

        self.assertEqual(confirmed.status, "mismatch")
        self.assertEqual(self.session.scalar(select(SubagentTraceArchive)).upload_status, "failed")  # type: ignore[union-attr]

    def test_confirm_does_not_mark_archive_ready_when_a_blob_is_missing(self) -> None:
        trace = b"complete-trace"
        screenshot = b"missing-image"
        service = SubagentTraceService(self.settings, self.session)
        prepared = service.prepare(self.current_user, self._prepare_request(trace, screenshot))
        self.bucket.objects[prepared.storage_key] = (trace, hashlib.sha256(trace).hexdigest())

        confirmed = service.confirm(
            self.current_user,
            SubagentTraceConfirmRequest(
                local_project_id="local-project",
                child_run_id="child-run-1",
                trace_sha256=hashlib.sha256(trace).hexdigest(),
                blob_sha256s=[hashlib.sha256(screenshot).hexdigest()],
            ),
        )

        self.assertEqual(confirmed.status, "missing")
        self.assertEqual(confirmed.blobs[0].status, "missing")
        self.assertEqual(self.session.scalar(select(SubagentTraceArchive)).upload_status, "failed")  # type: ignore[union-attr]
        self.assertEqual(self.session.scalar(select(SubagentTraceBlobArchive)).upload_status, "failed")  # type: ignore[union-attr]

    def test_prepare_rejects_cross_user_child_run_rebinding(self) -> None:
        trace = b"owned-trace"
        screenshot = b"owned-image"
        service = SubagentTraceService(self.settings, self.session)
        service.prepare(self.current_user, self._prepare_request(trace, screenshot))
        original = self.session.scalar(select(SubagentTraceArchive))
        self.assertIsNotNone(original)

        other_user = User(
            email="other-trace@example.com",
            password_hash="hashed",
            display_name="Other Trace",
        )
        self.session.add(other_user)
        self.session.commit()
        other_current_user = CurrentUserData(
            user=UserView.model_validate(other_user),
            organization=OrganizationView.model_validate(self.organization),
            role="member",
        )
        conflicting_payload = self._prepare_request(trace, screenshot).model_copy(
            update={
                "local_project_id": "other-local-project",
                "project_name": "Other Trace Project",
            }
        )

        with self.assertRaises(AppError) as raised:
            service.prepare(other_current_user, conflicting_payload)

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.error_code, "subagent_trace_scope_conflict")
        self.session.expire_all()
        persisted = self.session.scalar(select(SubagentTraceArchive))
        self.assertEqual(persisted.archived_by_user_id, self.user.id)  # type: ignore[union-attr]
        self.assertEqual(persisted.project_archive_id, original.project_archive_id)  # type: ignore[union-attr]


if __name__ == "__main__":
    unittest.main()
