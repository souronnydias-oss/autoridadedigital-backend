import { createClient } from '@supabase/supabase-js'

let supabase = null
let useSupabase = false

try {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_KEY?.trim()
  if (url && key) {
    supabase = createClient(url, key)
    useSupabase = true
    console.log('[supabase] initialized')
  } else {
    console.log('[supabase] disabled: set SUPABASE_URL and SUPABASE_KEY to enable.')
  }
} catch (e) {
  console.log('[supabase] initialization error:', e.message, '- falling back to SQLite')
}

export { supabase, useSupabase }