import React from 'react'
import ReactDOM from 'react-dom/client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import WhalesApp from './whales/WhalesApp.jsx'
import ButterfliesApp from './butterflies/ButterfliesApp.jsx'
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
          <Route path="/whales" element={<WhalesApp />} />
          <Route path="/butterflies" element={<ButterfliesApp />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </PostHogProvider>
  </React.StrictMode>,
)
