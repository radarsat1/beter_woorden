'use client'

import { useAuth } from './AuthProvider'
import {
  PlusIcon,
  QueueListIcon,
  PlayIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'

export default function Intro() {
  const { user } = useAuth()

  return (
    <div className="flex h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scrollbar">

        <header className="px-8 py-10 border-b border-gray-100 bg-gray-50/50">
          <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.email?.split('@')[0]}</h1>
          <p className="text-gray-500">Follow these steps to generate your first AI-powered quiz.</p>
        </header>

        <div className="p-8 max-w-3xl">
          <div className="relative">
            {/* Vertical Line Connector */}
            <div className="absolute left-[27px] top-4 bottom-4 w-0.5 bg-gray-100" />

            <div className="space-y-12">
              {/* Step 1 */}
              <div className="relative flex gap-8">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center z-10 border-4 border-white">
                  <PlusIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">1. Create a Word List</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Click on <strong className="text-gray-900">"Word Lists"</strong> in the sidebar. Create a new list (e.g., <code className="bg-gray-100 px-1 rounded text-orange-700">Thema 2: De Woning</code>) and add the Dutch words you are currently studying.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="relative flex gap-8">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center z-10 border-4 border-white">
                  <QueueListIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">2. Target Your Learning</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Navigate to <strong className="text-gray-900">"Quizzes"</strong> and click "Generate Quiz". Select the list you just created. Our agents will use these words as the "anchor" for generating quiz content.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="relative flex gap-8">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-green-100 text-green-600 flex items-center justify-center z-10 border-4 border-white">
                  <PlayIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">3. Start the Session</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Once the agent finishes gathering context, launch the quiz. You'll see real sentences where your target words have been removed. Use the <span className="italic">Word Bank</span> or <span className="italic">Hints</span> if you get stuck!
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="relative flex gap-8">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center z-10 border-4 border-white">
                  <CheckCircleIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">4. Review and Progress</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Your results are saved automatically. You can review past attempts to see how your accuracy improves over time as you move through your Dutch course.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto m-8 p-6 bg-blue-50 rounded-2xl border border-blue-100">
          <h4 className="text-blue-900 font-bold mb-1">Pro Tip</h4>
          <p className="text-blue-800/80 text-sm">
            For the best results, add 10-15 words per list. This gives the AI agent enough variety to find diverse articles across the web.
          </p>
        </div>
      </div>
    </div>
  )
}
