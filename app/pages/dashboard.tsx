import Head from 'next/head'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/components/AuthProvider'
import Sidebar from '@/components/Sidebar'
import Intro from '@/components/Intro'
import WordListEditor from '@/components/WordListEditor'
import QuizList from '@/components/QuizList'
import QuizRunner from '@/components/QuizRunner'
import QuizReview from '@/components/QuizReview'

export default function DashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  // Navigation State
  const [view, setView] = useState('quizzes')
  const [activeQuizId, setActiveQuizId] = useState<number | null>(null)
  const [activeAttemptId, setActiveAttemptId] = useState<number | null>(null)
  const [isReviewing, setIsReviewing] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // Security Guard: Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/')
    }
  }, [user, loading, router])

  // Continuous Sync: URL -> State (Handles Back Button & Direct Links)
  useEffect(() => {
    if (router.isReady && user) {
      const qView = (router.query.v as string) || 'intro'
      const qId = Number(router.query.id) || null
      const qAttempt = Number(router.query.attempt) || null
      const qReview = router.query.mode === 'review'

      if (view !== qView) setView(qView)
      if (activeQuizId !== qId) setActiveQuizId(qId)
      if (activeAttemptId !== qAttempt) setActiveAttemptId(qAttempt)
      if (isReviewing !== qReview) setIsReviewing(qReview)
    }
  }, [router.query, router.isReady, user])

  // Navigation Helper: Updates State immediately AND pushes to URL
  const navigate = (params: { v?: string, id?: number | null, attempt?: number | null, mode?: string | null }) => {
    // Update local state for immediate UI feedback
    if (params.v !== undefined) setView(params.v)
    if (params.id !== undefined) setActiveQuizId(params.id)
    if (params.attempt !== undefined) setActiveAttemptId(params.attempt)
    if (params.mode !== undefined) setIsReviewing(params.mode === 'review')

    // Update URL
    const newQuery = { ...router.query, ...params }
    const cleanedQuery = Object.fromEntries(
      Object.entries(newQuery).filter(([_, v]) => v != null)
    )

    router.push({ query: cleanedQuery }, undefined, { shallow: true })
  }

  const resetQuizState = () => {
    navigate({ id: null, attempt: null, mode: null })
  }

  // Prevent flash of content while checking auth
  if (loading || !user) return null

  return (
    <>
      <Head>
        <title>Dashboard | Beter Woorden</title>
      </Head>

      <div className="flex h-screen bg-white overflow-hidden">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          currentView={view}
          onChangeView={(v: string) => {
            navigate({ v, id: null, attempt: null, mode: null })
            setIsSidebarOpen(false)
          }}
        />

        {/* Mobile Header */}
        <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center px-4 z-30">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="ml-4 font-bold text-gray-900">Beter Woorden</span>
        </div>

        <main className="flex-1 h-full flex flex-col overflow-y-auto bg-gray-50 pt-16 md:pt-0">
          {/* VIEW: INTRO */}
          {view === 'intro' && <Intro />}

          {/* VIEW: WORD LISTS */}
          {view === 'wordlists' && <WordListEditor />}

          {/* VIEW: QUIZZES DASHBOARD */}
          {view === 'quizzes' && !activeQuizId && (
            <QuizList
              onSelectQuiz={(id, attemptId) => {
                if (attemptId) {
                  navigate({ id, attempt: attemptId, mode: 'review' })
                } else {
                  // If starting new, clear any progress cache first
                  localStorage.removeItem(`quiz_progress_${id}`)
                  navigate({ id, attempt: null, mode: null })
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
              key={`runner-${activeQuizId}-${activeAttemptId || 'new'}`}
              quizId={activeQuizId}
              onFinish={(newAttemptId) => {
                navigate({ attempt: newAttemptId, mode: 'review' })
              }}
            />
          )}
        </main>
      </div>
    </>
  )
}
