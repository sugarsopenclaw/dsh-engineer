from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.api.dependencies import get_billing_service, get_current_user
from app.core.errors import AppError
from app.domain.billing.pricing import pricing_table
from app.models.billing import (
    BillingOrderStatusView,
    BillingProductView,
    CreateWeChatNativeOrderRequest,
    CreditPricingView,
    WeChatNativeOrderView,
)
from app.models.common import ApiResponse
from app.models.user import CurrentUserData
from app.services.billing.billing_service import BillingService

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/products", response_model=ApiResponse[list[BillingProductView]])
def list_billing_products(
    billing_service: Annotated[BillingService, Depends(get_billing_service)],
) -> ApiResponse[list[BillingProductView]]:
    return ApiResponse(data=billing_service.products())


@router.get("/pricing", response_model=ApiResponse[CreditPricingView])
def get_credit_pricing() -> ApiResponse[CreditPricingView]:
    """Rate card so the client can show an estimated cost without re-deriving it."""
    return ApiResponse(data=CreditPricingView.model_validate(pricing_table()))


@router.post("/wechat/native/orders", response_model=ApiResponse[WeChatNativeOrderView])
def create_wechat_native_order(
    payload: CreateWeChatNativeOrderRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    billing_service: Annotated[BillingService, Depends(get_billing_service)],
) -> ApiResponse[WeChatNativeOrderView]:
    return ApiResponse(
        data=billing_service.create_wechat_native_order(current_user, payload.product_id),
    )


@router.get("/orders/{order_id}", response_model=ApiResponse[BillingOrderStatusView])
def get_billing_order(
    order_id: str,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    billing_service: Annotated[BillingService, Depends(get_billing_service)],
) -> ApiResponse[BillingOrderStatusView]:
    return ApiResponse(data=billing_service.get_order_status(current_user, order_id))


@router.post("/orders/{order_id}/sync", response_model=ApiResponse[BillingOrderStatusView])
def sync_billing_order(
    order_id: str,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    billing_service: Annotated[BillingService, Depends(get_billing_service)],
) -> ApiResponse[BillingOrderStatusView]:
    return ApiResponse(data=billing_service.sync_order(current_user, order_id))


@router.post("/wechat/native/notify")
async def wechat_native_notify(
    request: Request,
    billing_service: Annotated[BillingService, Depends(get_billing_service)],
) -> JSONResponse:
    headers = {
        "Wechatpay-Signature": request.headers.get("Wechatpay-Signature"),
        "Wechatpay-Timestamp": request.headers.get("Wechatpay-Timestamp"),
        "Wechatpay-Nonce": request.headers.get("Wechatpay-Nonce"),
        "Wechatpay-Serial": request.headers.get("Wechatpay-Serial"),
    }
    try:
        body = await request.body()
        result = billing_service.handle_wechat_notify(headers, body)
    except AppError as exc:
        return JSONResponse(
            status_code=exc.status_code if exc.status_code >= 400 else 400,
            content={"code": "FAIL", "message": exc.message},
        )
    except Exception:
        return JSONResponse(status_code=500, content={"code": "FAIL", "message": "处理失败"})
    return JSONResponse(content=result)
