
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DatabaseOrder } from '../types/databaseOrder'

interface RiderDashboardProps {
  onLogout: () => void
}

interface RiderOrder extends DatabaseOrder {
  restaurants: {
    name: string
  } | null
}

const ORDER_SELECT = `
  id,
  customer_id,
  restaurant_id,
  rider_id,
  status,
  total_cents,
  created_at,
  order_items (
    id,
    item_name,
    unit_price_cents,
    quantity
  ),
  restaurants (
    name
  )
`

const REQUEST_TIMEOUT_MS = 10000
const MAX_ACCEPT_ATTEMPTS = 2

function isTransientError(error: {
  message?: string
  code?: string
  status?: number
  name?: string
}) {
  const message = error.message?.toLowerCase() ?? ''

  if (error.status !== undefined && error.status >= 500) {
    return true
  }

  if (error.name === 'AbortError' || error.code === '57014') {
    return true
  }

  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('connection reset') ||
    message.includes('temporarily unavailable') ||
    message.includes('aborted')
  )
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

function RiderDashboard({ onLogout }: RiderDashboardProps) {
  const [availableOrders, setAvailableOrders] = useState<RiderOrder[]>([])
  const [activeOrders, setActiveOrders] = useState<RiderOrder[]>([])

  const [loading, setLoading] = useState(true)
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null)
  const [updatingDeliveryOrderId, setUpdatingDeliveryOrderId] =
    useState<string | null>(null)

  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Retain the same key when an acceptance request needs to be retried.
  const idempotencyKeys = useRef<Record<string, string>>({})

  // Load available orders and orders already assigned to this rider.
  const loadOrders = useCallback(async () => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to identify the logged-in rider.')
      }

      const { data: availableData, error: availableError } =
        await supabase
          .from('orders')
          .select(ORDER_SELECT)
          .eq('status', 'ready_for_pickup')
          .is('rider_id', null)
          .order('created_at', { ascending: true })

      if (availableError) {
        throw new Error(
          `Unable to load available orders: ${availableError.message}`,
        )
      }

      const { data: activeData, error: activeError } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('rider_id', user.id)
        .in('status', ['assigned', 'picked_up'])
        .order('created_at', { ascending: false })

      if (activeError) {
        throw new Error(
          `Unable to load your active deliveries: ${activeError.message}`,
        )
      }

      setAvailableOrders((availableData ?? []) as unknown as RiderOrder[])
      setActiveOrders((activeData ?? []) as unknown as RiderOrder[])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while loading orders.',
      )
    }
  }, [])

  // Load dashboard data when the rider dashboard opens.
  useEffect(() => {
    let isActive = true

    async function initialize() {
      setLoading(true)
      await loadOrders()

      if (isActive) {
        setLoading(false)
      }
    }

    void initialize()

    return () => {
      isActive = false
    }
  }, [loadOrders])

  // Make one acceptance request with a 10-second timeout.
  async function makeAcceptRequest(
    orderId: string,
    idempotencyKey: string,
  ) {
    const controller = new AbortController()

    const timeoutId = window.setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)

    try {
      return await supabase
        .rpc('accept_order', {
          p_order_id: orderId,
          p_idempotency_key: idempotencyKey,
        })
        .abortSignal(controller.signal)
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  // Accept an order with safe retry and timeout recovery.
  async function handleAcceptOrder(orderId: string) {
    if (acceptingOrderId !== null || updatingDeliveryOrderId !== null) {
      return
    }

    setError('')
    setMessage('')
    setAcceptingOrderId(orderId)

    if (!idempotencyKeys.current[orderId]) {
      idempotencyKeys.current[orderId] = crypto.randomUUID()
    }

    const idempotencyKey = idempotencyKeys.current[orderId]

    try {
      for (let attempt = 1; attempt <= MAX_ACCEPT_ATTEMPTS; attempt++) {
        try {
          const { data, error: acceptError } = await makeAcceptRequest(
            orderId,
            idempotencyKey,
          )

          if (acceptError) {
            if (acceptError.message.toLowerCase().includes('unavailable')) {
              throw new Error(
                'This order is no longer available. Another rider may have accepted it.',
              )
            }

            if (!isTransientError(acceptError)) {
              throw new Error(
                `Unable to accept order: ${acceptError.message}`,
              )
            }

            if (attempt === MAX_ACCEPT_ATTEMPTS) {
              throw new Error(
                'The server did not respond after retrying. Your request may still have succeeded. Press Accept Order again to safely retry.',
              )
            }
          } else if (data) {
            delete idempotencyKeys.current[orderId]

            setMessage('Order accepted successfully!')
            await loadOrders()
            return
          } else {
            throw new Error(
              'The server returned an unexpected response. Please refresh and try again.',
            )
          }
        } catch (err) {
          if (err instanceof Error && !isTransientError(err)) {
            throw err
          }

          if (attempt === MAX_ACCEPT_ATTEMPTS) {
            throw new Error(
              'Network request failed after retrying. The order may already have been accepted. Press Accept Order again to safely retry.',
              { cause: err },
            )
          }
        }

        await sleep(500 * 2 ** (attempt - 1))
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while accepting the order.',
      )

      // Keep the key after an uncertain network failure.
      await loadOrders()
    } finally {
      setAcceptingOrderId(null)
    }
  }

  // Update delivery progress through the secure PostgreSQL RPC.
  async function handleDeliveryStatusUpdate(
    orderId: string,
    newStatus: 'picked_up' | 'delivered',
  ) {
    if (
      updatingDeliveryOrderId !== null ||
      acceptingOrderId !== null
    ) {
      return
    }

    setError('')
    setMessage('')
    setUpdatingDeliveryOrderId(orderId)

    try {
      const { data, error: updateError } = await supabase.rpc(
        'update_delivery_status',
        {
          p_order_id: orderId,
          p_new_status: newStatus,
        },
      )

      if (updateError) {
        throw new Error(updateError.message)
      }

      if (data !== newStatus) {
        throw new Error(
          'The server returned an unexpected delivery status.',
        )
      }

      setMessage(
        newStatus === 'picked_up'
          ? 'Order marked as picked up successfully!'
          : 'Delivery completed successfully!',
      )

      // Fetch the latest database state.
      await loadOrders()
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unable to update delivery: ${err.message}`
          : 'An unexpected error occurred while updating delivery status.',
      )

      // Refresh in case the server completed the request
      // but the client did not receive the expected response.
      await loadOrders()
    } finally {
      setUpdatingDeliveryOrderId(null)
    }
  }

  function formatStatus(status: string) {
    return status.replaceAll('_', ' ')
  }

  // Reusable order card for active and available orders.
  function renderOrderCard(order: RiderOrder, isActive: boolean) {
    const isUpdating = updatingDeliveryOrderId === order.id

    return (
      <article className="order-card" key={order.id}>
        <div>
          <h3>{order.restaurants?.name ?? 'Restaurant'}</h3>

          <p>Order ID: {order.id.slice(0, 8)}</p>

          <div className="order-items">
            {order.order_items.map((item) => (
              <p key={item.id}>
                {item.quantity} × {item.item_name}
              </p>
            ))}
          </div>

          <div className="order-bottom">
            <strong>₹{(order.total_cents / 100).toFixed(2)}</strong>

            <span>{new Date(order.created_at).toLocaleString()}</span>
          </div>

          <p className="rider-order-status">
            Status: {formatStatus(order.status)}
          </p>
        </div>

        {isActive ? (
          <div className="delivery-actions">
            {order.status === 'assigned' && (
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  void handleDeliveryStatusUpdate(order.id, 'picked_up')
                }
                disabled={
                  isUpdating ||
                  updatingDeliveryOrderId !== null ||
                  acceptingOrderId !== null
                }
              >
                {isUpdating ? 'Updating...' : 'Mark Picked Up'}
              </button>
            )}

            {order.status === 'picked_up' && (
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  void handleDeliveryStatusUpdate(order.id, 'delivered')
                }
                disabled={
                  isUpdating ||
                  updatingDeliveryOrderId !== null ||
                  acceptingOrderId !== null
                }
              >
                {isUpdating ? 'Updating...' : 'Mark Delivered'}
              </button>
            )}

            <span className="waiting-message">
              {order.status === 'assigned'
                ? 'Assigned to you'
                : 'Delivery in progress'}
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleAcceptOrder(order.id)}
            disabled={
              acceptingOrderId !== null ||
              updatingDeliveryOrderId !== null
            }
          >
            {acceptingOrderId === order.id
              ? 'Accepting...'
              : 'Accept Order'}
          </button>
        )}
      </article>
    )
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">Y</div>

          <div>
            <h1>Yumingo Rider</h1>
            <p>Delivery Partner Dashboard</p>
          </div>
        </div>

        <button type="button" onClick={onLogout}>
          Sign Out
        </button>
      </header>

      <main className="dashboard-content">
        <section className="dashboard-heading">
          <div>
            <h2>Rider Dashboard</h2>
            <p>Manage available deliveries and your active orders.</p>
          </div>

          <button
            type="button"
            onClick={() => void loadOrders()}
            disabled={loading}
          >
            Refresh
          </button>
        </section>

        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}

        {loading ? (
          <p>Loading your deliveries...</p>
        ) : (
          <>
            <section className="orders-section">
              <div className="section-heading">
                <h2>My Active Delivery</h2>
                <span className="section-count">
                  {activeOrders.length}
                </span>
              </div>

              {activeOrders.length === 0 ? (
                <div className="empty-state">
                  <h3>No active deliveries</h3>
                  <p>Orders you accept will appear here.</p>
                </div>
              ) : (
                <div className="orders-list">
                  {activeOrders.map((order) =>
                    renderOrderCard(order, true),
                  )}
                </div>
              )}
            </section>

            <section className="orders-section">
              <div className="section-heading">
                <h2>Available Deliveries</h2>
                <span className="section-count">
                  {availableOrders.length}
                </span>
              </div>

              {availableOrders.length === 0 ? (
                <div className="empty-state">
                  <h3>No available orders</h3>
                  <p>Check again shortly for new pickup requests.</p>
                </div>
              ) : (
                <div className="orders-list">
                  {availableOrders.map((order) =>
                    renderOrderCard(order, false),
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="app-footer">
        Yumingo Rider Application
      </footer>
    </div>
  )
}

export default RiderDashboard
