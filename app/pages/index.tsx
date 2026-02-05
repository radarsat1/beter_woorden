import Head from 'next/head'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '@/utils/supabase'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { useAuth } from '@/components/AuthProvider'
import { SparklesIcon, GlobeAltIcon, CpuChipIcon, ArrowDownIcon } from '@heroicons/react/24/outline'

const Auth = dynamic(
  () => import('@supabase/auth-ui-react').then((mod) => mod.Auth),
  { ssr: false }
)

export default function LoginPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  // Create a ref for the login section
  const authSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard')
    }
  }, [user, loading, router])

  const scrollToLogin = () => {
    authSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  if (loading) return null

  return (
    <>
      <Head>
        <title>Beter Woorden | AI-Powered Dutch Learning</title>
      </Head>

      <div className="min-h-screen flex flex-col md:flex-row bg-white">

        {/* --- Left Side: Marketing/Tech Demo --- */}
        <div className="flex-1 bg-gradient-to-br from-orange-500 via-orange-600 to-indigo-700 p-8 md:p-16 flex flex-col justify-center text-white relative overflow-hidden">

          {/* MOBILE ONLY: Shortcut to Login */}
          <button
            onClick={scrollToLogin}
            className="md:hidden absolute top-6 right-6 z-20 flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-sm font-bold"
          >
            Sign In <ArrowDownIcon className="w-4 h-4" />
          </button>

          <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-500/20 rounded-full translate-x-1/4 translate-y-1/4 blur-3xl" />

          <div className="relative z-10 max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-xs font-bold uppercase tracking-wider mb-8">
              <SparklesIcon className="w-4 h-4" />
              Agentic Language Learning
            </div>

            <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight">
              Beter <br /> Woorden
            </h1>

            <p className="text-xl md:text-2xl font-medium text-orange-50 mb-12 leading-relaxed">
              We use AI agents to browse the Dutch web and create custom quizzes based on <strong>your</strong> target vocabulary.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-white/10 rounded-lg"><GlobeAltIcon className="w-6 h-6" /></div>
                <div>
                  <h3 className="font-bold text-lg">Real Context</h3>
                  <p className="text-orange-100/80 text-sm">Sentences pulled from actual Dutch news and articles.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="p-2 bg-white/10 rounded-lg"><CpuChipIcon className="w-6 h-6" /></div>
                <div>
                  <h3 className="font-bold text-lg">Powered by LangGraph</h3>
                  <p className="text-orange-100/80 text-sm">Advanced reasoning agents via OpenRouter models.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-24 pt-8 border-t border-white/10 text-xs font-medium text-orange-200/60 uppercase tracking-widest flex gap-6">
            <span>Next.js 15</span>
            <span>Supabase</span>
            <span>OpenRouter</span>
          </div>
        </div>

        {/* --- Right Side: Auth Form --- */}
        <div
          ref={authSectionRef} // Attach the ref here
          className="w-full md:w-[480px] flex items-center justify-center p-8 bg-gray-50 min-h-[600px] md:min-h-screen"
        >
          <div className="w-full max-w-sm">
            <div className="mb-8 text-center md:text-left">
              <h2 className="text-2xl font-bold text-gray-900">Get Started</h2>
              <p className="text-gray-500">Sign in to start your personalized Dutch session.</p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200">
              <Auth
                supabaseClient={supabase}
                appearance={{
                  theme: ThemeSupa,
                  variables: {
                    default: {
                      colors: {
                        brand: '#ea580c',
                        brandAccent: '#c2410c',
                      }
                    }
                  }
                }}
                theme="light"
                providers={[]}
              />
            </div>

            {/* Optional back-to-top for mobile */}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="md:hidden w-full mt-8 text-gray-400 text-xs font-medium uppercase tracking-widest"
            >
              Back to info ↑
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
