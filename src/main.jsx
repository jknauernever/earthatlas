import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import ExploreApp from './explore/ExploreApp.jsx'
import whalesConfig from './explore/configs/whales.js'
import sharksConfig from './explore/configs/sharks.js'
import butterfliesConfig from './explore/configs/butterflies.js'
import tigersConfig from './explore/configs/tigers.js'
import lionsConfig from './explore/configs/lions.js'
import dolphinsConfig from './explore/configs/dolphins.js'
import elephantsConfig from './explore/configs/elephants.js'
import bearsConfig from './explore/configs/bears.js'
import monkeysConfig from './explore/configs/monkeys.js'
import hipposConfig from './explore/configs/hippos.js'
import wolvesConfig from './explore/configs/wolves.js'
import condorsConfig from './explore/configs/condors.js'
import slothsConfig from './explore/configs/sloths.js'
import fungiConfig from './explore/configs/fungi.js'
import birdsConfig from './explore/configs/birds.js'
import SpeciesDetailPage from './species/SpeciesDetailPage.jsx'
import NewsArticlePage from './news/NewsArticlePage.jsx'
import AdminApp from './admin/AdminApp.jsx'
import LiveGlobe from './live/LiveGlobe.jsx'
import LiveLocal from './live/LiveLocal.jsx'
import ForestMonitor from './forestmonitor/ForestMonitor.jsx'
import FireApp from './fire/FireApp.jsx'
import QuakesApp from './quakes/QuakesApp.jsx'
import './index.css'

// Sentry: only initialize in production builds AND when a DSN is configured.
// Dev still gets noisy errors in the console; prod gets structured capture +
// session replay on errors. Set VITE_SENTRY_DSN in Vercel to enable.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn && import.meta.env.PROD) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,        // no idle session replays
    replaysOnErrorSampleRate: 1.0,      // capture replay only when an error fires
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    // Drop low-signal noise (browser extensions, third-party script errors).
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
  })
  // Expose the SDK on window for prod smoke-testing from devtools console
  // (window.Sentry.captureMessage("…"), captureException(new Error(…)), etc.).
  // Only the public API surface — nothing secret here.
  window.Sentry = Sentry
}

const phKey = import.meta.env.VITE_POSTHOG_KEY
if (phKey) {
  posthog.init(phKey, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    autocapture: true,
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PostHogProvider client={posthog}>
      <BrowserRouter>
        <Routes>
          <Route path="/whales" element={<ExploreApp config={whalesConfig} />} />
          <Route path="/sharks" element={<ExploreApp config={sharksConfig} />} />
          <Route path="/butterflies" element={<ExploreApp config={butterfliesConfig} />} />
          <Route path="/tigers" element={<ExploreApp config={tigersConfig} />} />
          <Route path="/lions" element={<ExploreApp config={lionsConfig} />} />
          <Route path="/dolphins" element={<ExploreApp config={dolphinsConfig} />} />
          <Route path="/elephants" element={<ExploreApp config={elephantsConfig} />} />
          <Route path="/bears" element={<ExploreApp config={bearsConfig} />} />
          <Route path="/monkeys" element={<ExploreApp config={monkeysConfig} />} />
          <Route path="/hippos" element={<ExploreApp config={hipposConfig} />} />
          <Route path="/wolves" element={<ExploreApp config={wolvesConfig} />} />
          <Route path="/condors" element={<ExploreApp config={condorsConfig} />} />
          <Route path="/sloths" element={<ExploreApp config={slothsConfig} />} />
          <Route path="/fungi" element={<ExploreApp config={fungiConfig} />} />
          <Route path="/birds" element={<ExploreApp config={birdsConfig} />} />
          <Route path="/species/:taxonId" element={<SpeciesDetailPage />} />
          <Route path="/news/:species/:slug" element={<NewsArticlePage />} />
          <Route path="/live" element={<LiveGlobe />} />
          <Route path="/live-local" element={<LiveLocal />} />
          <Route path="/forestmonitor" element={<ForestMonitor />} />
          <Route path="/fire" element={<FireApp />} />
          <Route path="/quakes" element={<QuakesApp />} />
          <Route path="/admin" element={<AdminApp />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </PostHogProvider>
  </React.StrictMode>,
)
