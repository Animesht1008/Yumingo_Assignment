
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { supabase } from '../lib/supabase'

interface CustomerDashboardProps {
  customerId: string
  onLogout: () => Promise<void>
}

interface Restaurant {
  id: string
  name: string
  address: string
  is_open: boolean
}

interface MenuItem {
  id: string
  restaurant_id: string
  name: string
  price_cents: number
  is_available: boolean
}

interface CartItem {
  menuItem: MenuItem
  quantity: number
}

interface CustomerOrderItem {
  id: string
  item_name: string
  unit_price_cents: number
  quantity: number
}

interface CustomerOrder {
  id: string
  status: string
  total_cents: number
  created_at: string
  restaurants: { name: string } | null
  order_items: CustomerOrderItem[]
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f5f7f8',
    color: '#172b25',
  },
  header: {
    background: '#ffffff',
    padding: '18px 5%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #e5e9e7',
    gap: '16px',
  },
  content: {
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '32px 20px',
  },
  heading: {
    marginBottom: '24px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '16px',
  },
  card: {
    background: '#ffffff',
    border: '1px solid #e5e9e7',
    borderRadius: '12px',
    padding: '18px',
    boxShadow: '0 3px 12px rgba(0,0,0,0.035)',
  },
  button: {
    background: '#08765b',
    color: '#ffffff',
    border: 'none',
    borderRadius: '7px',
    padding: '10px 15px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  secondaryButton: {
    background: '#e7f3ef',
    color: '#08765b',
    border: '1px solid #cce5dc',
    borderRadius: '7px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  section: {
    marginTop: '36px',
  },
  muted: {
    color: '#687872',
    fontSize: '14px',
  },
  error: {
    background: '#feecec',
    color: '#b42318',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '18px',
  },
  success: {
    background: '#e4f7ed',
    color: '#087443',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '18px',
  },
}

function formatPrice(priceCents: number): string {
  return `₹${(priceCents / 100).toFixed(2)}`
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function CustomerDashboard({
  customerId,
  onLogout,
}: CustomerDashboardProps) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [orders, setOrders] = useState<CustomerOrder[]>([])

  const [loadingRestaurants, setLoadingRestaurants] = useState(true)
  const [loadingMenu, setLoadingMenu] = useState(false)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [placingOrder, setPlacingOrder] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const selectedRestaurant = restaurants.find(
    (restaurant) => restaurant.id === selectedRestaurantId,
  )

  const cartItems = useMemo(() => Object.values(cart), [cart])

  const cartTotal = useMemo(
    () =>
      cartItems.reduce(
        (total, item) =>
          total + item.menuItem.price_cents * item.quantity,
        0,
      ),
    [cartItems],
  )

  const cartQuantity = useMemo(
    () => cartItems.reduce((total, item) => total + item.quantity, 0),
    [cartItems],
  )

  // Load restaurants that are currently open.
  const loadRestaurants = useCallback(async () => {
    setError('')
    setLoadingRestaurants(true)

    try {
      const { data, error: fetchError } = await supabase
        .from('restaurants')
        .select('id, name, address, is_open')
        .eq('is_open', true)
        .order('name')

      if (fetchError) throw fetchError

      const availableRestaurants = (data ?? []) as Restaurant[]
      setRestaurants(availableRestaurants)

      setSelectedRestaurantId((current) => {
        if (
          current &&
          availableRestaurants.some(
            (restaurant) => restaurant.id === current,
          )
        ) {
          return current
        }

        return availableRestaurants[0]?.id ?? ''
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load restaurants.',
      )
    } finally {
      setLoadingRestaurants(false)
    }
  }, [])

  // Load the menu for the selected restaurant.
  const loadMenu = useCallback(async () => {
    if (!selectedRestaurantId) {
      setMenuItems([])
      return
    }

    setLoadingMenu(true)
    setError('')

    try {
      const { data, error: fetchError } = await supabase
        .from('menu_items')
        .select('id, restaurant_id, name, price_cents, is_available')
        .eq('restaurant_id', selectedRestaurantId)
        .eq('is_available', true)
        .order('name')

      if (fetchError) throw fetchError

      setMenuItems((data ?? []) as MenuItem[])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load the menu.',
      )
    } finally {
      setLoadingMenu(false)
    }
  }, [selectedRestaurantId])

  // Load only the authenticated customer's order history.
  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)

    try {
      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(`
          id,
          status,
          total_cents,
          created_at,
          restaurants ( name ),
          order_items (
            id,
            item_name,
            unit_price_cents,
            quantity
          )
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError

      setOrders((data ?? []) as unknown as CustomerOrder[])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load your orders.',
      )
    } finally {
      setLoadingOrders(false)
    }
  }, [customerId])

  // Defer initial data loading until after the effects complete.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRestaurants()
      void loadOrders()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadRestaurants, loadOrders])

  // Reload menu whenever the selected restaurant changes.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMenu()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadMenu])

  // Add an item or increase its quantity.
  function addToCart(menuItem: MenuItem) {
    setError('')
    setSuccess('')

    setCart((current) => ({
      ...current,
      [menuItem.id]: {
        menuItem,
        quantity: (current[menuItem.id]?.quantity ?? 0) + 1,
      },
    }))
  }

  // Change quantity or remove an item.
  function updateQuantity(menuItemId: string, change: number) {
    setCart((current) => {
      const existing = current[menuItemId]

      if (!existing) return current

      const nextQuantity = existing.quantity + change
      const updated = { ...current }

      if (nextQuantity <= 0) {
        delete updated[menuItemId]
      } else {
        updated[menuItemId] = {
          ...existing,
          quantity: nextQuantity,
        }
      }

      return updated
    })
  }

  // Place an order using the server-side price calculation RPC.
  async function handlePlaceOrder() {
    if (!selectedRestaurantId || cartItems.length === 0) return

    setPlacingOrder(true)
    setError('')
    setSuccess('')

    try {
      const items = cartItems.map(({ menuItem, quantity }) => ({
        menu_item_id: menuItem.id,
        quantity,
      }))

      const { data, error: orderError } = await supabase.rpc(
        'place_order',
        {
          p_restaurant_id: selectedRestaurantId,
          p_items: items,
        },
      )

      if (orderError) throw orderError

      if (!data) {
        throw new Error('The order was not created. Please try again.')
      }

      setCart({})
      setSuccess(
        `Your order has been placed successfully! Order ID: ${data}`,
      )

      await loadOrders()
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unable to place order: ${err.message}`
          : 'An unexpected error occurred while placing your order.',
      )
    } finally {
      setPlacingOrder(false)
    }
  }

  async function handleSignOut() {
    setLoggingOut(true)

    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h2 style={{ margin: 0, color: '#08765b' }}>Yumingo</h2>
          <span style={styles.muted}>Customer Application</span>
        </div>

        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => void handleSignOut()}
          disabled={loggingOut}
        >
          {loggingOut ? 'Signing out...' : 'Sign Out'}
        </button>
      </header>

      <main style={styles.content}>
        <section style={styles.heading}>
          <h1>Discover restaurants</h1>
          <p style={styles.muted}>
            Browse menus, place orders, and track your deliveries.
          </p>
        </section>

        {error && (
          <div style={styles.error} role="alert">
            {error}
          </div>
        )}

        {success && (
          <div style={styles.success} role="status">
            {success}
          </div>
        )}

        <section>
          <h2>Restaurants</h2>

          {loadingRestaurants ? (
            <p>Loading restaurants...</p>
          ) : restaurants.length === 0 ? (
            <div style={styles.card}>
              <p>No restaurants are currently open.</p>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => void loadRestaurants()}
              >
                Try again
              </button>
            </div>
          ) : (
            <div style={styles.grid}>
              {restaurants.map((restaurant) => {
                const isSelected =
                  restaurant.id === selectedRestaurantId

                return (
                  <article
                    key={restaurant.id}
                    style={{
                      ...styles.card,
                      border: isSelected
                        ? '2px solid #08765b'
                        : '1px solid #e5e9e7',
                    }}
                  >
                    <h3>{restaurant.name}</h3>
                    <p style={styles.muted}>{restaurant.address}</p>

                    <button
                      type="button"
                      style={
                        isSelected
                          ? styles.button
                          : styles.secondaryButton
                      }
                      onClick={() => {
                        setSelectedRestaurantId(restaurant.id)
                        setCart({})
                        setSuccess('')
                        setError('')
                      }}
                    >
                      {isSelected ? 'Selected' : 'View Menu'}
                    </button>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {selectedRestaurant && (
          <section style={styles.section}>
            <h2>Menu — {selectedRestaurant.name}</h2>

            {loadingMenu ? (
              <p>Loading menu...</p>
            ) : menuItems.length === 0 ? (
              <div style={styles.card}>
                <p>No available menu items at this restaurant.</p>
              </div>
            ) : (
              <div style={styles.grid}>
                {menuItems.map((item) => (
                  <article key={item.id} style={styles.card}>
                    <h3>{item.name}</h3>
                    <p style={{ fontWeight: 700 }}>
                      {formatPrice(item.price_cents)}
                    </p>

                    <button
                      type="button"
                      style={styles.button}
                      onClick={() => addToCart(item)}
                    >
                      Add to Cart
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <section style={styles.section}>
          <h2>Your Cart ({cartQuantity} items)</h2>

          {cartItems.length === 0 ? (
            <div style={styles.card}>
              <p style={styles.muted}>
                Your cart is empty. Add items from a menu.
              </p>
            </div>
          ) : (
            <div style={styles.card}>
              {cartItems.map(({ menuItem, quantity }) => (
                <div
                  key={menuItem.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 0',
                    borderBottom: '1px solid #edf0ef',
                  }}
                >
                  <div>
                    <strong>{menuItem.name}</strong>
                    <p style={styles.muted}>
                      {formatPrice(menuItem.price_cents)} each
                    </p>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <button
                      type="button"
                      style={styles.secondaryButton}
                      onClick={() => updateQuantity(menuItem.id, -1)}
                      aria-label={`Remove one ${menuItem.name}`}
                    >
                      −
                    </button>

                    <strong>{quantity}</strong>

                    <button
                      type="button"
                      style={styles.secondaryButton}
                      onClick={() => updateQuantity(menuItem.id, 1)}
                      aria-label={`Add one ${menuItem.name}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '18px',
                  fontSize: '18px',
                  fontWeight: 700,
                }}
              >
                <span>Total</span>
                <span>{formatPrice(cartTotal)}</span>
              </div>

              <button
                type="button"
                style={{
                  ...styles.button,
                  width: '100%',
                  marginTop: '18px',
                  opacity: placingOrder ? 0.6 : 1,
                }}
                onClick={() => void handlePlaceOrder()}
                disabled={placingOrder || cartItems.length === 0}
              >
                {placingOrder ? 'Placing Order...' : 'Place Order'}
              </button>
            </div>
          )}
        </section>

        <section style={styles.section}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <h2>My Orders</h2>

            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => void loadOrders()}
              disabled={loadingOrders}
            >
              {loadingOrders ? 'Refreshing...' : 'Refresh Orders'}
            </button>
          </div>

          {loadingOrders ? (
            <p>Loading your orders...</p>
          ) : orders.length === 0 ? (
            <div style={styles.card}>
              <p style={styles.muted}>
                You haven't placed any orders yet.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '14px' }}>
              {orders.map((order) => (
                <article key={order.id} style={styles.card}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>
                      {order.restaurants?.name ?? 'Restaurant'}
                    </strong>

                    <span
                      style={{
                        color: '#08765b',
                        fontWeight: 700,
                        textTransform: 'capitalize',
                      }}
                    >
                      {order.status.replaceAll('_', ' ')}
                    </span>
                  </div>

                  <p style={styles.muted}>
                    Order ID: {order.id.slice(0, 8)}
                  </p>

                  {order.order_items?.map((item) => (
                    <p key={item.id} style={styles.muted}>
                      {item.quantity} × {item.item_name} —{' '}
                      {formatPrice(
                        item.unit_price_cents * item.quantity,
                      )}
                    </p>
                  ))}

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '12px',
                    }}
                  >
                    <strong>{formatPrice(order.total_cents)}</strong>
                    <span style={styles.muted}>
                      {formatDate(order.created_at)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer
        style={{
          textAlign: 'center',
          padding: '20px',
          color: '#687872',
          fontSize: '13px',
        }}
      >
        Yumingo Customer Application
      </footer>
    </div>
  )
}

export default CustomerDashboard
