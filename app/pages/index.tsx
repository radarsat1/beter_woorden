import Head from 'next/head'
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '@/utils/supabase'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { useAuth } from '@/components/AuthProvider'

// Dynamic import for Auth to avoid SSR issues
const Auth = dynamic(
  () => import('@supabase/auth-ui-react').then((mod) => mod.Auth),
  { ssr: false }
)

export default function LoginPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  // If user is already logged in, send them to the dashboard
  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard')
    }
  }, [user, loading, router])

  if (loading) return null

  return (
    <>
      <Head>
        <title>Login | Beter Woorden</title>
      </Head>

      <div className="min-w-full min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full h-full flex justify-center items-center p-4">
          <div className="w-full h-full sm:h-auto sm:w-96 max-w-md p-8 bg-white shadow-lg rounded-xl flex flex-col border border-gray-100">
            <h1 className="font-sans text-3xl font-bold text-center mb-2 text-gray-900">
              Beter Woorden
            </h1>
            <p className="text-center text-gray-500 mb-6 text-sm">Sign in to start learning</p>
            <Auth
              supabaseClient={supabase}
              appearance={{
                theme: ThemeSupa,
                variables: {
                  default: {
                    colors: {
                      brand: '#2563eb',
                      brandAccent: '#1d4ed8',
                    }
                  }
                }
              }}
              theme="light"
              providers={[]}
            />
          </div>
        </div>
      </div>
    </>
  )
}