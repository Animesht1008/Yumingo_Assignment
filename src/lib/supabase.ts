
// ============================================
// SUPABASE CLIENT CONFIGURATION
// ============================================

// Import the function used to create a Supabase client.
import { createClient } from '@supabase/supabase-js'

// Read the Supabase URL from the environment variables.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

// Read the public publishable key from environment variables.
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Ensure both configuration values are available.
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase environment variables are missing.')
}

// Create one reusable Supabase client for the application.
export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
)
