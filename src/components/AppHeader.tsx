
interface AppHeaderProps {
  onLogout: () => void
}

function AppHeader({ onLogout }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-icon">Y</div>

        <div>
          <h1>Yumingo</h1>
          <p>Restaurant Management</p>
        </div>
      </div>

      <div className="restaurant-info">
        <div className="restaurant-details">
          <strong>Green Leaf Restaurant</strong>
          <span>Restaurant Dashboard</span>
        </div>

        <div className="online-status">
          <span className="status-dot"></span>
          Online
        </div>

        <button
          type="button"
          className="logout-button"
          onClick={onLogout}
          style={{
            backgroundColor: '#14765B',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 18px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.2s ease',
          }}
        >
          Sign Out
        </button>
      </div>
    </header>
  )
}

export default AppHeader
