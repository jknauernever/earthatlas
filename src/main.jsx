import React from 'react'
import ReactDOM from 'react-dom/client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import ExploreApp from './explore/ExploreApp.jsx'
import whalesConfig from './explore/configs/whales.js'
import sharksConfig from './explore/configs/sharks.js'
import butterfliesConfig from './explore/configs/butterflies.js'
import SpeciesDetailPage from './species/SpeciesDetailPage.jsx'
import './index.css'

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
          <Route path="/butterflies" element={<ExploreApp config={butterfliesConfig} />} />
          <Route path="/sharks" element={<ExploreApp config={sharksConfig} />} />
          <Route path="/species/:taxonId" element={<SpeciesDetailPage />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </PostHogProvider>
  </React.StrictMode>,
)
