from __future__ import annotations

from sqlalchemy.orm import Session

from app.schemas.client_download_event import ClientDownloadEvent


class ClientDownloadEventRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        *,
        version: str,
        release_channel: str,
        platform: str,
        source: str | None,
        ip_address: str | None,
        user_agent: str | None,
        referer: str | None,
        redirect_url: str,
    ) -> ClientDownloadEvent:
        record = ClientDownloadEvent(
            version=version,
            release_channel=release_channel,
            platform=platform,
            source=source,
            ip_address=ip_address,
            user_agent=user_agent,
            referer=referer,
            redirect_url=redirect_url,
        )
        self.session.add(record)
        self.session.flush()
        return record
