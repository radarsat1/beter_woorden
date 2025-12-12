import '@/styles/app.css'
import type { AppProps } from 'next/app'
import { AuthProvider } from '@/components/AuthProvider' // Import your new provider

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  )
}
