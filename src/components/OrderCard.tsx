
import { useState } from 'react'
import type {
  DatabaseOrder,
  DatabaseOrderStatus,
} from '../types/databaseOrder'

interface RestaurantOrder extends DatabaseOrder {
  customerName: string
}

interface OrderCardProps {
  order: RestaurantOrder
  onStatusChange: (
    orderId: string,
    newStatus: DatabaseOrderStatus,
  ) => Promise<void>
}

const nextAction: Partial<
  Record<DatabaseOrderStatus, {
    label: string
    nextStatus: DatabaseOrderStatus
  }>
> = {
  placed: {
    label: 'Accept Order',
    nextStatus: 'accepted',
  },
  accepted: {
    label: 'Start Preparing',
    nextStatus: 'preparing',
  },
  preparing: {
    label: 'Mark Ready for Pickup',
    nextStatus: 'ready_for_pickup',
  },
}

const statusLabels: Record<DatabaseOrderStatus, string> = {
  placed: 'New Order',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready for Pickup',
  assigned: 'Assigned to Rider',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

function OrderCard({ order, onStatusChange }: OrderCardProps) {
  const [updating, setUpdating] = useState(false)

  const action = nextAction[order.status]

  async function handleStatusUpdate() {
    if (!action || updating) return

    setUpdating(true)

    try {
      await onStatusChange(order.id, action.nextStatus)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <article className="order-card">
      <div className="order-top">
        <div>
          <h3>Order #{order.id.slice(0, 8)}</h3>
          <p>{order.customerName}</p>
        </div>

        <span
          className={`order-status ${order.status.replaceAll('_', '-')}`}
        >
          {statusLabels[order.status]}
        </span>
      </div>

      <div className="order-items">
        {order.order_items.map((item) => (
          <p key={item.id}>
            {item.quantity} × {item.item_name}
          </p>
        ))}
      </div>

      <div className="order-bottom">
        <strong>
          ₹{(order.total_cents / 100).toFixed(2)}
        </strong>

        <span>
          {new Date(order.created_at).toLocaleString()}
        </span>
      </div>

      <div className="order-actions">
        {action ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleStatusUpdate()}
            disabled={updating}
          >
            {updating ? 'Updating...' : action.label}
          </button>
        ) : order.status === 'ready_for_pickup' ? (
          <span className="waiting-message">
            Waiting for rider assignment
          </span>
        ) : (
          <span className="waiting-message">
            {statusLabels[order.status]}
          </span>
        )}
      </div>
    </article>
  )
}

export default OrderCard
