import type {
  BillingOrderStatusView,
  BillingProductView,
  WeChatNativeOrderView,
} from '../../../src/shared/backend-api'
import { backendRequest } from './http'

export class BillingApiClient {
  listProducts() {
    return backendRequest<BillingProductView[]>('/billing/products')
  }

  createWeChatNativeOrder(accessToken: string, productId: string) {
    return backendRequest<WeChatNativeOrderView>('/billing/wechat/native/orders', {
      method: 'POST',
      accessToken,
      body: { product_id: productId },
    })
  }

  getOrder(accessToken: string, orderId: string) {
    return backendRequest<BillingOrderStatusView>(`/billing/orders/${encodeURIComponent(orderId)}`, {
      accessToken,
    })
  }

  syncOrder(accessToken: string, orderId: string) {
    return backendRequest<BillingOrderStatusView>(
      `/billing/orders/${encodeURIComponent(orderId)}/sync`,
      {
        method: 'POST',
        accessToken,
      },
    )
  }
}

export const billingApiClient = new BillingApiClient()
