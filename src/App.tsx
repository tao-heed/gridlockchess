// App.tsx — Main application entry point
import { MotionConfig } from 'framer-motion';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LocalGame } from '@/components/game/LocalGame';
import { WelcomeProvider } from '@/components/game/modals';
import { PwaUpdatePrompt } from '@/components/ui/PwaUpdatePrompt';
import { HomePage, RulesPage, LicensesPage, ChangelogPage, AboutPage, SandboxPage } from '@/pages';

export function App() {
  return (
    // Respect the OS "reduce motion" accessibility setting across every framer-motion
    // animation at once (transforms/layout are damped when the user prefers reduced motion).
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <WelcomeProvider>
          <div className="flex min-h-screen flex-col">
            <Routes>
              {/* Game routes */}
              <Route path="/" element={<HomePage />} />
              <Route
                path="/play"
                element={
                  <main className="flex-1">
                    <LocalGame />
                  </main>
                }
              />
              {/* Documentation routes - self-contained layout */}
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/licenses" element={<LicensesPage />} />
              <Route path="/changelog" element={<ChangelogPage />} />
              <Route path="/about" element={<AboutPage />} />
              {/* Position editor */}
              <Route path="/sandbox" element={<SandboxPage />} />
            </Routes>
          </div>
          <PwaUpdatePrompt />
        </WelcomeProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}

export { App as default };
