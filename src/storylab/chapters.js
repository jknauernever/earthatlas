/**
 * The five starter chapters (copy from docs/design/inmotion-lab/sketches/
 * Chapters.dc.html; the sketch's bracketed sources replaced with the real
 * layerDefs sources). Each chapter names the real layers it turns on and
 * where the camera goes.
 */

export const CHAPTERS = [
  {
    short: 'The air moves',
    title: 'The air is always on the move',
    body: 'Every breeze is part of a planet-wide circulation. Warm air rises near the equator, cool air sinks near the poles, and the spin of the Earth bends it all into the jet stream and the trade winds.',
    phoneBody: 'Every breeze is part of a planet-wide circulation, bent by the Earth’s spin into the jet stream and the trade winds.',
    layers: ['wind'],
    source: 'NOAA GFS',
    camera: { lat: 22, lng: -38, zoom: 1.7, bearing: 0, pitch: 0 },
  },
  {
    short: 'Where smoke goes',
    title: 'Smoke does not stay where the fire is',
    body: 'When large fires burn, the wind lifts their smoke and carries it across borders and oceans. Watch the hot spots on the ground, then follow the haze downwind to see who ends up breathing it.',
    phoneBody: 'Wind lifts smoke from large fires and carries it across borders and oceans. Follow the haze downwind to see who breathes it.',
    // Fires bring smoke and wind with them on /inmotion; listed here so the chips match the globe.
    layers: ['hotspots', 'smoke', 'wind'],
    source: 'NASA FIRMS, Copernicus CAMS, NOAA GFS',
    // Framed on South America and West Africa, where the fire layer showed the
    // most burning on 2026-11-12. Retune with the seasons.
    camera: { lat: -2, lng: -30, zoom: 2.2, bearing: 0, pitch: 0 },
  },
  {
    short: 'Ocean conveyor',
    title: 'Rivers inside the sea',
    body: 'Surface currents move heat from the tropics toward the poles. They shape coastal weather, carry plankton and larvae, and decide where floating debris and spilled oil end up.',
    phoneBody: 'Surface currents move heat toward the poles and decide where plankton, debris and spilled oil end up.',
    layers: ['currents', 'sst'],
    source: 'HYCOM / Navy ESPC, NOAA Coral Reef Watch',
    camera: { lat: 36, lng: -62, zoom: 3.1, bearing: 0, pitch: 0 },
  },
  {
    short: 'A warming sea',
    title: 'Warmer than it should be',
    body: 'This view compares today with a long-term normal for the same date. Patches of unusual heat, called marine heatwaves, can bleach corals and push fish and kelp out of their usual range.',
    phoneBody: 'Today compared with the long-term normal for this date. Patches of unusual heat are marine heatwaves.',
    layers: ['sstanom'],
    source: 'NOAA Coral Reef Watch, compared with a normal built from 1985–2012 satellite records',
    camera: { lat: 5, lng: -150, zoom: 1.8, bearing: 0, pitch: 0 },
  },
  {
    short: 'Life on the move',
    title: 'Millions of travelers overnight',
    body: 'On spring and fall nights, weather radar picks up waves of migrating birds. Their timing follows the same winds shown in the first chapter.',
    phoneBody: 'On migration nights, weather radar picks up waves of birds riding the same winds from chapter one.',
    layers: ['birds', 'wind'],
    source: 'BirdCast (Cornell Lab of Ornithology), NOAA GFS',
    camera: { lat: 38.5, lng: -95, zoom: 3.3, bearing: 0, pitch: 0 },
  },
]

/** The first chapter (1-based) that features a layer, else chapter 1. */
export function chapterFor(layerId) {
  if (!layerId) return 1
  const i = CHAPTERS.findIndex((c) => c.layers.includes(layerId))
  return i >= 0 ? i + 1 : 1
}
