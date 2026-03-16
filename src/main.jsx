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
          <Route path="/species/:taxonId" element={<SpeciesDetailPage />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </PostHogProvider>
  </React.StrictMode>,
)
