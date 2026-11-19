
export type DatabaseOrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'rejected'
  | 'cancelled'

export interface DatabaseOrderItem {
  id: string
  item_name: string
  unit_price_cents: number
  quantity: number
}

export interface DatabaseOrder {
  id: string
  customer_id: string
  restaurant_id: string
  rider_id: string | null
  status: DatabaseOrderStatus
  total_cents: number
  created_at: string
  order_items: DatabaseOrderItem[]
}
