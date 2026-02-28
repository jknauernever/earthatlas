// Maps iNaturalist iconic taxon names → display color, emoji, label
export const TAXON_META = {
  Plantae:         { color: '#3d5a3e', emoji: '🌿', label: 'Plants'     },
  Aves:            { color: '#4a6b8a', emoji: '🐦', label: 'Birds'      },
  Mammalia:        { color: '#7a5c3a', emoji: '🦌', label: 'Mammals'    },
  Insecta:         { color: '#8a6a2a', emoji: '🦋', label: 'Insects'    },
  Reptilia:        { color: '#5a7a3a', emoji: '🦎', label: 'Reptiles'   },
  Amphibia:        { color: '#3a7a6a', emoji: '🐸', label: 'Amphibians' },
  Fungi:           { color: '#7a4a6a', emoji: '🍄', label: 'Fungi'      },
  Arachnida:       { color: '#8a3a3a', emoji: '🕷',  label: 'Arachnids' },
  Actinopterygii:  { color: '#3a5a8a', emoji: '🐟', label: 'Fish'       },
  Mollusca:        { color: '#6a5a8a', emoji: '🐚', label: 'Mollusks'   },
  Chromista:       { color: '#4a7a6a', emoji: '🌊', label: 'Chromista'  },
}

export const DEFAULT_META = { color: '#6a6a6a', emoji: '🔬', label: 'Other' }

export function getTaxonMeta(iconicTaxonName) {
  return TAXON_META[iconicTaxonName] || DEFAULT_META
}

export const TAXON_FILTER_OPTIONS = [
  { key: 'all',           label: 'All Taxa'    },
  { key: 'Plantae',       label: '🌿 Plants'   },
  { key: 'Aves',          label: '🐦 Birds'    },
  { key: 'Mammalia',      label: '🦌 Mammals'  },
  { key: 'Insecta',       label: '🦋 Insects'  },
  { key: 'Reptilia',      label: '🦎 Reptiles' },
  { key: 'Amphibia',      label: '🐸 Amphibians'},
  { key: 'Fungi',         label: '🍄 Fungi'    },
  { key: 'Arachnida',     label: '🕷 Arachnids'},
]

export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return 'Unknown date'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', ...opts,
  })
}

export function getDateRangeStart(window) {
  if (window === 'all') return null
  const d = new Date()
  if      (window === 'hour')  d.setHours(d.getHours() - 1)
  else if (window === 'day')   d.setDate(d.getDate() - 1)
  else if (window === 'week')  d.setDate(d.getDate() - 7)
  else if (window === 'month') d.setMonth(d.getMonth() - 1)
  else if (window === 'year')  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().split('T')[0]
}
