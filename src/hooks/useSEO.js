import { useEffect } from 'react'

const BASE_URL = 'https://earthatlas.org'

function setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    if (name.startsWith('og:')) {
      el.setAttribute('property', name)
    } else {
      el.setAttribute('name', name)
    }
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/**
 * useSEO — sets document title, meta description, Open Graph, and canonical URL.
 *
 * Usage:
 *   useSEO({
 *     title: 'Shark Sightings Near You',
 *     description: 'Discover which sharks have been sighted near any coastline...',
 *     path: '/sharks',
 *     image: '/shark-hero.jpg',
 *   })
 */
export function useSEO({ title, description, path, image }) {
  useEffect(() => {
    const fullTitle = title ? `${title} — EarthAtlas` : 'EarthAtlas — Species Explorer'
    document.title = fullTitle

    if (description) setMeta('description', description)

    // Open Graph
    setMeta('og:title', fullTitle)
    if (description) setMeta('og:description', description)
    setMeta('og:type', 'website')
    if (path) setMeta('og:url', `${BASE_URL}${path}`)
    if (image) setMeta('og:image', `${BASE_URL}${image}`)

    // Twitter card
    setMeta('twitter:card', 'summary_large_image')
    setMeta('twitter:title', fullTitle)
    if (description) setMeta('twitter:description', description)
    if (image) setMeta('twitter:image', `${BASE_URL}${image}`)

    // Canonical
    if (path) {
      let link = document.querySelector('link[rel="canonical"]')
      if (!link) {
        link = document.createElement('link')
        link.setAttribute('rel', 'canonical')
        document.head.appendChild(link)
      }
      link.setAttribute('href', `${BASE_URL}${path}`)
    }

    return () => {
      document.title = 'EarthAtlas — Species Explorer'
    }
  }, [title, description, path, image])
}
