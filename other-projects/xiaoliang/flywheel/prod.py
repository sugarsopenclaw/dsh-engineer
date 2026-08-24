"""Bootstrap admin's read-only production engine without writing to it."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from contextlib import contextmanager

from flywheel.config import ADMIN_SERVER, env_file, load_env_file_into_environ


def bootstrap_admin() -> None:
    load_env_file_into_environ(env_file())
    admin_server = str(ADMIN_SERVER)
    if admin_server not in sys.path:
        sys.path.insert(0, admin_server)


def get_prod_session_factory():
    bootstrap_admin()
    from app.db import get_session_factory  # noqa: WPS433

    return get_session_factory()


@contextmanager
def prod_session() -> Iterator:
    factory = get_prod_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()
