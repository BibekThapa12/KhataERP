import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const) {
    const value = env[name]?.trim()
    if (!value || value.startsWith('your-') || value.includes('your-project-id')) {
      throw new Error(`Build refused: missing production-safe ${name}. Configure it in the deployment environment.`)
    }
  }

  const url = new URL(env.VITE_SUPABASE_URL)
  if (mode === 'production' && url.protocol !== 'https:') {
    throw new Error('Build refused: VITE_SUPABASE_URL must use HTTPS in production.')
  }
  if (/^sb_secret_/i.test(env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error('Build refused: a Supabase secret key cannot be embedded in the browser.')
  }
  if (mode === 'production' && env.VITE_WRITE_PERF === 'true') {
    throw new Error('Build refused: VITE_WRITE_PERF must be false in production.')
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
