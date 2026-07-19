/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_HCAPTCHA_SITE_KEY: string
  readonly VITE_WRITE_PERF?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
