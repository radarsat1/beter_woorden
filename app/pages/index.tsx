import Head from 'next/head'
import { supabase } from '@/utils/supabase'
//import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { useAuth } from '@/components/AuthProvider'
import Sidebar from '@/components/Sidebar'
import WordListEditor from '@/components/WordListEditor'
import QuizList from '@/components/QuizList'
import QuizRunner from '@/components/QuizRunner'
import QuizReview from '@/components/QuizReview'
import { useState } from 'react'

import dynamic from 'next/dynamic'
const Auth = dynamic(
  () => import('@supabase/auth-ui-react').then((mod) => mod.Auth),
  { ssr: false }
)

export default function Home() {
  const { user, loading } = useAuth()
  const [view, setView] = useState('quizzes') // 'wordlists' | 'quizzes'
  const [activeQuizId, setActiveQuizId] = useState<number | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [isReviewing, setIsReviewing] = useState(false)

  return (
    <>
      <Head>
        <title>Daily Dutch</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />

      </Head>
      
      <div className="w-full h-screen bg-white overflow-hidden">
        {(!user || loading) ? (
          <div className="min-w-full min-h-screen flex items-center justify-center">
            <div className="w-full h-full flex justify-center items-center p-4">
              <div className="w-full h-full sm:h-auto sm:w-2/5 max-w-sm p-5 bg-white shadow flex flex-col text-base">
                <span className="font-sans text-4xl text-center pb-2 mb-1 border-b mx-4 align-center">
                Daily Dutch: Login
                </span>
                <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} theme="dark" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full">
            <Sidebar 
              currentView={view} 
              onChangeView={(v) => {
                setView(v)
                setActiveQuizId(null)
                setIsReviewing(false)
              }}
            />
            
            <main className="flex-1 h-full overflow-hidden bg-gray-50">
              {view === 'wordlists' && <WordListEditor />}
              
              {view === 'quizzes' && !activeQuizId && (
                <QuizList 
                  onSelectQuiz={(id, sessionId) => {
                    setActiveQuizId(id)
                    if (sessionId) {
                      setActiveSessionId(sessionId)
                      setIsReviewing(true)
                    } else {
                      setIsReviewing(false)
                    }
                  }} 
                />
              )}

              {view === 'quizzes' && activeQuizId && isReviewing && activeSessionId && (
                <QuizReview 
                  quizId={activeQuizId} 
                  sessionId={activeSessionId}
                  onBack={() => setActiveQuizId(null)} 
                />
              )}

              {view === 'quizzes' && activeQuizId && !isReviewing && (
                <QuizRunner 
                  quizId={activeQuizId} 
                  onFinish={(sid) => {
                    setActiveSessionId(sid)
                    setIsReviewing(true)
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
