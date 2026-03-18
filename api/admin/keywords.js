/**
 * Admin API — Species keyword mapping CRUD.
 *
 * GET    /api/admin/keywords                    — list all keywords (grouped by species)
 * POST   /api/admin/keywords                    — add keyword { speciesSlug, keyword }
 * PUT    /api/admin/keywords?species=sharks      — AI suggest keywords for a species
 * DELETE /api/admin/keywords?id=5               — delete keyword
 */

import { migrate, getAllKeywords, getKeywordsForSpecies, addKeyword, deleteKeyword } from '../../lib/db.js'
import { authorizeRequest, json } from '../../lib/auth.js'
import { suggestKeywords } from '../../lib/ai.js'

export default { async fetch(req) {
  if (!authorizeRequest(req)) return json({ error: 'Unauthorized' }, 401)
  await migrate()

  const method = req.method
  const { searchParams } = new URL(req.url)

  if (method === 'GET') {
    const rows = await getAllKeywords()
    // Group by species for easier consumption
    const grouped = {}
    for (const row of rows) {
      if (!grouped[row.species_slug]) grouped[row.species_slug] = []
      grouped[row.species_slug].push(row)
    }
    return json({ keywords: rows, grouped })
  }

  if (method === 'POST') {
    const { speciesSlug, keyword } = await req.json()
    if (!speciesSlug || !keyword?.trim()) {
      return json({ error: 'speciesSlug and keyword required' }, 400)
    }
    const row = await addKeyword({ speciesSlug, keyword })
    return json({ keyword: row, created: !!row })
  }

  if (method === 'PUT') {
    const speciesSlug = searchParams.get('species')
    if (!speciesSlug) return json({ error: 'species query param required' }, 400)
    const existing = await getKeywordsForSpecies(speciesSlug)
    const existingKeywords = existing.map(r => r.keyword)
    const suggestions = await suggestKeywords({ speciesSlug, existingKeywords })
    return json({ speciesSlug, suggestions })
  }

  if (method === 'DELETE') {
    const id = searchParams.get('id')
    if (!id) return json({ error: 'id required' }, 400)
    await deleteKeyword(parseInt(id, 10))
    return json({ deleted: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}
}
