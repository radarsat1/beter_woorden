import { createClient } from '@supabase/supabase-js'
import { Database } from '@/lib/schema'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Export a single instance
export const supabase = createClient<Database>(supabaseUrl, supabaseKey)
