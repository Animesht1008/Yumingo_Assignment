
// ============================================
// ORDER TYPES
// ============================================

// Define all statuses an order can have.
export type OrderStatus =
  | 'New'
  | 'Accepted'
  | 'Preparing'
  | 'Ready for pickup'

// Define the structure of an individual order.
export interface Order {
  id: number
  customerName: string
  items: string[]
  total: number
  status: OrderStatus
  time: string
}
