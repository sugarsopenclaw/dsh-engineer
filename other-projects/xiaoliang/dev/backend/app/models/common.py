from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(from_attributes=True)

    success: bool = True
    data: T
    message: str | None = None


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    message: str | None = None


class OperationStatus(BaseModel):
    ok: bool = True