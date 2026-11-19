
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase } from './lib/supabase'

import AppHeader from './components/AppHeader'
import SummaryCard from './components/SummaryCard'
import OrderCard from './components/OrderCard'
import RiderDashboard from './components/RiderDashboard'
import CustomerDashboard from './components/CustomerDashboard'

import type {
  DatabaseOrder,
  DatabaseOrderStatus,
} from './types/databaseOrder'

interface RestaurantOrder extends DatabaseOrder {
  customerName: string
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const authenticatedUserId = session?.user.id

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [profileLoading, setProfileLoading] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [riderAuthorized, setRiderAuthorized] = useState(false)

  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [restaurantOrders, setRestaurantOrders] = useState<RestaurantOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)

  const [accessError, setAccessError] = useState('')

  // Listen for Supabase authentication changes.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
    })

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Verify the authenticated user's role and permissions.
  useEffect(() => {
    if (!authenticatedUserId) {
      return
    }

    let isActive = true

    async function verifyUserAccess() {
      setProfileLoading(true)
      setAccessError('')
      setUserRole(null)
      setRiderAuthorized(false)
      setRestaurantId(null)

      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', authenticatedUserId)
          .single()

        if (profileError || !profile) {
          throw new Error('Unable to verify your user profile.')
        }

        if (!isActive) return

        setUserRole(profile.role)

        // Verify rider profile.
        if (profile.role === 'rider') {
          const { data: rider, error: riderError } = await supabase
            .from('riders')
            .select('id')
            .eq('id', authenticatedUserId)
            .maybeSingle()

          if (riderError) {
            throw new Error(
              `Unable to verify rider access: ${riderError.message}`,
            )
          }

          if (!rider) {
            throw new Error('Rider profile not found.')
          }

          if (!isActive) return

          setRiderAuthorized(true)
          return
        }

        // Verify restaurant ownership.
        if (profile.role === 'restaurant_owner') {
          const { data: restaurant, error: restaurantError } =
            await supabase
              .from('restaurants')
              .select('id')
              .eq('owner_id', authenticatedUserId)
              .maybeSingle()

          if (restaurantError) {
            throw new Error(
              `Unable to verify restaurant access: ${restaurantError.message}`,
            )
          }

          if (!restaurant) {
            throw new Error(
              'No restaurant is associated with this account.',
            )
          }

          if (!isActive) return

          setRestaurantId(restaurant.id)
          return
        }

        // Customers are authorized through their authenticated profile.
        if (profile.role === 'customer') {
          return
        }

        throw new Error(
          'Your account does not have permission to access this application.',
        )
      } catch (error) {
        if (!isActive) return

        setAccessError(
          error instanceof Error
            ? error.message
            : 'An unexpected authorization error occurred.',
        )
      } finally {
        if (isActive) {
          setProfileLoading(false)
        }
      }
    }

    void verifyUserAccess()

    return () => {
      isActive = false
    }
  }, [authenticatedUserId])

  // Fetch orders belonging to the authenticated restaurant.
  const loadRestaurantOrders = useCallback(async () => {
    if (!restaurantId) return

    setOrderError('')

    const { data, error } = await supabase
      .from('orders')
      .select(`
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
        )
      `)
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })

    if (error) {
      setOrderError(`Unable to load restaurant orders: ${error.message}`)
      return
    }

    const formattedOrders: RestaurantOrder[] = (
      (data ?? []) as unknown as DatabaseOrder[]
    ).map((order) => ({
      ...order,
      customerName: `Customer ${order.customer_id.slice(0, 8)}`,
    }))

    setRestaurantOrders(formattedOrders)
  }, [restaurantId])

  // Load orders after restaurant ownership is verified.
  useEffect(() => {
    if (!restaurantId) return

    let isActive = true

    async function initializeOrders() {
      setOrdersLoading(true)

      await loadRestaurantOrders()

      if (isActive) {
        setOrdersLoading(false)
      }
    }

    void initializeOrders()

    return () => {
      isActive = false
    }
  }, [restaurantId, loadRestaurantOrders])

  // Authenticate the user.
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setAuthLoading(true)
    setAccessError('')

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setAccessError(error.message)
      }
    } catch {
      setAccessError('Unable to sign in. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  // Sign out the current user.
  async function handleLogout() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      setAccessError(`Unable to sign out: ${error.message}`)
      return
    }

    setEmail('')
    setPassword('')
    setUserRole(null)
    setRiderAuthorized(false)
    setRestaurantId(null)
    setRestaurantOrders([])
    setProfileLoading(false)
    setAccessError('')
    setOrderError('')
  }

  // Update the order status in PostgreSQL.
  async function handleStatusChange(
    orderId: string,
    newStatus: DatabaseOrderStatus,
  ): Promise<void> {
    if (!restaurantId || updatingOrderId !== null) return

    setOrderError('')
    setUpdatingOrderId(orderId)

    try {
      const { data, error } = await supabase
        .from('orders')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('restaurant_id', restaurantId)
        .select('id, status')
        .single()

      if (error) {
        throw new Error(error.message)
      }

      if (!data) {
        throw new Error('The order could not be updated.')
      }

      await loadRestaurantOrders()
    } catch (error) {
      setOrderError(
        error instanceof Error
          ? `Unable to update order: ${error.message}`
          : 'An unexpected error occurred while updating the order.',
      )
    } finally {
      setUpdatingOrderId(null)
    }
  }

  // Login screen.
  if (!session) {
    return (
      <div className="app-container">
        <main className="login-container">
          <div className="login-card">
            <h1>Yumingo</h1>
            <p>Sign in to access your dashboard.</p>

            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>

              {accessError && (
                <p className="error-message" role="alert">
                  {accessError}
                </p>
              )}

              <button type="submit" disabled={authLoading}>
                {authLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </main>
      </div>
    )
  }

  // Wait for role and ownership verification.
  if (profileLoading) {
    return (
      <div className="app-container">
        <main className="dashboard-content">
          <p>Verifying your account permissions...</p>
        </main>
      </div>
    )
  }

  // Authorization errors.
  if (accessError) {
    return (
      <div className="app-container">
        <main className="dashboard-content">
          <section className="login-card">
            <h2>Access Denied</h2>
            <p className="error-message" role="alert">
              {accessError}
            </p>

            <button type="button" onClick={() => void handleLogout()}>
              Sign Out
            </button>
          </section>
        </main>
      </div>
    )
  }

  // Rider dashboard.
  if (userRole === 'rider' && riderAuthorized) {
    return <RiderDashboard onLogout={handleLogout} />
  }

  // Customer dashboard.
  if (userRole === 'customer') {
    return (
      <CustomerDashboard
        customerId={session.user.id}
        onLogout={handleLogout}
      />
    )
  }

  // Restaurant owner dashboard.
  if (userRole !== 'restaurant_owner' || !restaurantId) {
    return (
      <div className="app-container">
        <main className="dashboard-content">
          <section className="login-card">
            <h2>Access Denied</h2>
            <p>Your account is not authorized for this dashboard.</p>

            <button type="button" onClick={() => void handleLogout()}>
              Sign Out
            </button>
          </section>
        </main>
      </div>
    )
  }

  const newOrders = restaurantOrders.filter(
    (order) => order.status === 'placed',
  ).length

  const preparingOrders = restaurantOrders.filter(
    (order) =>
      order.status === 'accepted' ||
      order.status === 'preparing',
  ).length

  const readyOrders = restaurantOrders.filter(
    (order) => order.status === 'ready_for_pickup',
  ).length

  return (
    <div className="app-container">
      <AppHeader onLogout={handleLogout} />

      <main className="dashboard-content">
        <section className="dashboard-heading">
          <div>
            <h2>Restaurant Dashboard</h2>
            <p>Manage incoming orders and track their progress.</p>
          </div>

          <button
            type="button"
            onClick={() => void loadRestaurantOrders()}
            disabled={ordersLoading}
          >
            {ordersLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </section>

        {orderError && (
          <p role="alert">{orderError}</p>
        )}

        <section className="summary-grid">
          <SummaryCard
            title="New Orders"
            value={newOrders}
            description="Orders waiting for acceptance"
            variant="pending"
          />

          <SummaryCard
            title="Preparing"
            value={preparingOrders}
            description="Accepted or being prepared"
            variant="preparing"
          />

          <SummaryCard
            title="Ready for Pickup"
            value={readyOrders}
            description="Orders waiting for a rider"
            variant="ready"
          />
        </section>

        <section className="orders-section">
          <h2>Restaurant Orders</h2>

          {ordersLoading ? (
            <p>Loading restaurant orders...</p>
          ) : restaurantOrders.length === 0 ? (
            <div className="empty-state">
              <h3>No orders yet</h3>
              <p>New customer orders will appear here.</p>
            </div>
          ) : (
            <div className="orders-list">
              {restaurantOrders.map((order) => (
                <div
                  key={order.id}
                  className={
                    updatingOrderId === order.id
                      ? 'order-updating'
                      : ''
                  }
                >
                  <OrderCard
                    order={order}
                    onStatusChange={handleStatusChange}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        Yumingo Restaurant Application
      </footer>
    </div>
  )
}

export default App
