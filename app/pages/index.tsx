import Head from 'next/head'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '@/utils/supabase'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { useAuth } from '@/components/AuthProvider'
import Sidebar from '@/components/Sidebar'
import WordListEditor from '@/components/WordListEditor'
import QuizList from '@/components/QuizList'
import QuizRunner from '@/components/QuizRunner'
import QuizReview from '@/components/QuizReview'

// Dynamic import for Auth to avoid SSR issues with Supabase Auth UI
const Auth = dynamic(
  () => import('@supabase/auth-ui-react').then((mod) => mod.Auth),
  { ssr: false }
)

export default function Home() {
  const { user, loading } = useAuth()
  const router = useRouter()

  // 1. Keep local state as the primary driver (matches server defaults)
  const [view, setView] = useState('quizzes')
  const [activeQuizId, setActiveQuizId] = useState<number | null>(null)
  const [activeAttemptId, setActiveAttemptId] = useState<number | null>(null)
  const [isReviewing, setIsReviewing] = useState(false)

  // Mobile Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // 2. Continuous Sync: URL -> State
  // This handles the Back button. When the URL changes, state updates automatically.
  useEffect(() => {
    if (router.isReady) {
      const qView = (router.query.v as string) || 'quizzes'
      const qId = Number(router.query.quiz) || null
      const qAttempt = router.query.attempt ? Number(router.query.attempt) : null
      const qReview = router.query.mode === 'review'

      if (view !== qView) setView(qView)
      if (activeQuizId !== qId) setActiveQuizId(qId)
      if (activeAttemptId !== qAttempt) setActiveAttemptId(qAttempt)
      if (isReviewing !== qReview) setIsReviewing(qReview)
    }
  }, [router.query, router.isReady]) // Listen to query changes

  // 3. Helper to update URL
  // We no longer update state here manually; we let the useEffect above
  // handle it once the URL transition is processed by Next.js.
  const navigate = (
    params: {
      v?: string,
      quiz?: number | null,
      attempt?: number | null,
      mode?: string | null
    }
  ) => {
    const newQuery = { ...router.query, ...params }
    const cleanedQuery = Object.fromEntries(
      Object.entries(newQuery).filter(([_, value]) => value != null)
    );
    router.push({ query: cleanedQuery }, undefined, { shallow: true })
  }

  const resetQuizState = () => {
    navigate({ quiz: null, attempt: null, mode: null })
  }

  return (
    <>
      <Head>
        <title>Beter Woorden</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="w-full h-screen bg-white overflow-hidden">
        {(!user || loading) ? (
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
                  providers={[]} // Add 'google' or 'github' here if enabled
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full">
            <Sidebar
             isOpen={isSidebarOpen}
             onClose={() => setIsSidebarOpen(false)}
             currentView={view}
              onChangeView={(v: string) => {
                navigate({ v, quiz: null, attempt: null, mode: null })
                setIsSidebarOpen(false) // Close sidebar on mobile after selection
              }}
            />

            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center px-4 z-30">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <span className="ml-4 font-bold text-gray-900">Beter Woorden</span>
            </div>

            <main className="flex-1 h-full flex-col overflow-y-auto bg-gray-50 pt-16 md:pt-0">
              {/* VIEW: WORD LISTS */}
              {view === 'wordlists' && <WordListEditor />}

              {/* VIEW: QUIZZES DASHBOARD */}
              {view === 'quizzes' && !activeQuizId && (
                <QuizList
                  onSelectQuiz={(id, attemptId) => {
                    if (attemptId) {
                      navigate({ quiz: id, attempt: attemptId, mode: 'review' })
                    } else {
                      // Start New
                      navigate({ quiz: id, attempt: null, mode: null })
                    }
                  }}
                />
              )}

              {/* VIEW: QUIZ REVIEW (History) */}
              {view === 'quizzes' && activeQuizId && isReviewing && activeAttemptId && (
                <QuizReview
                  quizId={activeQuizId}
                  attemptId={activeAttemptId}
                  onBack={resetQuizState}
                />
              )}

              {/* VIEW: QUIZ RUNNER (Active) */}
              {view === 'quizzes' && activeQuizId && !isReviewing && (
                <QuizRunner
                  quizId={activeQuizId}
                  onFinish={(attemptId) => {
                    navigate({ attempt: attemptId, mode: 'review' })
                  }}
                />
              )}
            </main>
          </div>
        )}
      </div>
    </>
  )
}
