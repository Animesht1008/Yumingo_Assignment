
// ============================================
// SUMMARY CARD COMPONENT
// ============================================

// Define the visual variants supported by this component.
// Each variant corresponds to an existing CSS class.
type SummaryCardVariant =
  | 'default'
  | 'pending'
  | 'preparing'
  | 'ready'

// Define the data that the parent component
// must provide to SummaryCard through props.
interface SummaryCardProps {
  title: string
  value: number
  description: string
  variant?: SummaryCardVariant
}

// ============================================
// MAIN SUMMARY CARD COMPONENT
// ============================================

// Destructure the props to access their individual values.
function SummaryCard({
  title,
  value,
  description,
  variant = 'default',
}: SummaryCardProps) {

  // Convert the selected variant into the appropriate CSS class.
  const variantClass = {
    default: '',
    pending: 'pending-card',
    preparing: 'preparing-card',
    ready: 'ready-card',
  }[variant]

  return (

    // The CSS class changes according to the card variant.
    <div className={`summary-card ${variantClass}`}>

      {/* Display the card title */}
      <span className="summary-label">
        {title}
      </span>

      {/* Display the dynamic numerical value */}
      <h3>{value}</h3>

      {/* Display the supporting description */}
      <p>{description}</p>

    </div>
  )
}

// Export the component so App.tsx can reuse it.
export default SummaryCard
