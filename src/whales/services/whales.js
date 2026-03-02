/**
 * Whale-specific data service
 * Built on top of GBIF occurrence API + Whale Museum Hotline API
 *
 * GBIF Cetacea (order) backbone taxon key: 733
 * This covers all whales, dolphins, and porpoises.
 */

const GBIF_API    = 'https://api.gbif.org/v1'
const INAT_API    = 'https://api.inaturalist.org/v1'
const HOTLINE_API = 'https://hotline.whalemuseum.org/api'

const CETACEA_KEY = 733
const INAT_CETACEA_TAXON = 152871
const GBIF_INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7'

// ─── Species metadata ─────────────────────────────────────────────────────────
export const SPECIES_META = {
  // ─── Baleen whales ────────────────────────────────────────────────────────
  2440735: { common: 'Blue Whale', scientific: 'Balaenoptera musculus', color: '#1a5276', emoji: '🐳', lengthM: 30, fact: 'The largest animal ever known to exist — one heartbeat can be heard two miles away.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Anim1754_-_Flickr_-_NOAA_Photo_Library.jpg/640px-Anim1754_-_Flickr_-_NOAA_Photo_Library.jpg' },
  2440718: { common: 'Fin Whale', scientific: 'Balaenoptera physalus', color: '#1a5276', emoji: '🐋', lengthM: 25, fact: 'Second largest animal on Earth — and one of the fastest great whales at up to 23 mph.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Finhval_%281%29.jpg/640px-Finhval_%281%29.jpg' },
  2440709: { common: 'Sei Whale', scientific: 'Balaenoptera borealis', color: '#1a5276', emoji: '🐋', lengthM: 20, fact: 'Named for the Norwegian word for "coalfish" — the two arrive in feeding grounds together.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Sei_whale_mother_and_calf_Christin_Khan_NOAA.jpg/640px-Sei_whale_mother_and_calf_Christin_Khan_NOAA.jpg' },
  2440715: { common: 'Bryde\'s Whale', scientific: 'Balaenoptera brydei', color: '#1a5276', emoji: '🐋', lengthM: 14, fact: 'The only baleen whale that lives year-round in tropical waters, never migrating to polar seas.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/35/Balaenoptera_brydei.jpg' },
  2440714: { common: 'Eden\'s Whale', scientific: 'Balaenoptera edeni', color: '#1a5276', emoji: '🐋', lengthM: 12, fact: 'Went viral for its trap-feeding technique — rising vertically with jaws agape in the Gulf of Thailand.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/35/Balaenoptera_brydei.jpg' },
  2440734: { common: 'Omura\'s Whale', scientific: 'Balaenoptera omurai', color: '#1a5276', emoji: '🐋', lengthM: 11, fact: 'Only described as a new species in 2003 — one of the most recently discovered large whales.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Balaenoptera_omurai%2C_Madagascar_-_Royal_Society_Open_Science_1.jpg/640px-Balaenoptera_omurai%2C_Madagascar_-_Royal_Society_Open_Science_1.jpg' },
  2440728: { common: 'Common Minke Whale', scientific: 'Balaenoptera acutorostrata', color: '#1a5276', emoji: '🐋', lengthM: 9, fact: 'The most abundant baleen whale and the most frequently spotted on whale-watching trips.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Dwarf_minke_whale_%2830694501214%29.jpg/640px-Dwarf_minke_whale_%2830694501214%29.jpg' },
  7759914: { common: 'Antarctic Minke Whale', scientific: 'Balaenoptera bonaerensis', color: '#1a5276', emoji: '🐋', lengthM: 9, fact: 'Thrives in sea ice — the most numerous whale species in Antarctic waters.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Minke_whale_in_ross_sea.jpg/640px-Minke_whale_in_ross_sea.jpg' },
  5220086: { common: 'Humpback Whale', scientific: 'Megaptera novaeangliae', color: '#1a5276', emoji: '🐋', lengthM: 16, fact: 'Known for the longest songs in the animal kingdom — some lasting over 20 hours.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Humpback_Whale_underwater_shot.jpg/640px-Humpback_Whale_underwater_shot.jpg' },
  2440339: { common: 'North Atlantic Right Whale', scientific: 'Eubalaena glacialis', color: '#e06868', emoji: '🐋', lengthM: 16, fact: 'Critically endangered — fewer than 340 remain. Every sighting is precious data.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/GRNMS_-_Right_Whales_%2831361234602%29.jpg/640px-GRNMS_-_Right_Whales_%2831361234602%29.jpg' },
  9747921: { common: 'North Pacific Right Whale', scientific: 'Eubalaena japonica', color: '#d87060', emoji: '🐋', lengthM: 16, fact: 'Fewer than 500 remain — one of the rarest large whales on Earth.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Eubalaena_japonica_drawing.jpg/640px-Eubalaena_japonica_drawing.jpg' },
  2440332: { common: 'Southern Right Whale', scientific: 'Eubalaena australis', color: '#1a5276', emoji: '🐋', lengthM: 16, fact: 'Playful and approachable — they often "sail" by raising their flukes to catch the wind.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Southern_right_whale6.jpg/640px-Southern_right_whale6.jpg' },
  2440330: { common: 'Bowhead Whale', scientific: 'Balaena mysticetus', color: '#1a5276', emoji: '🐋', lengthM: 18, fact: 'Can live over 200 years — stone harpoon points from the 1800s have been found in living bowheads.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Bowhead_Whale_NOAA.jpg/640px-Bowhead_Whale_NOAA.jpg' },
  2440310: { common: 'Pygmy Right Whale', scientific: 'Caperea marginata', color: '#1a5276', emoji: '🐋', lengthM: 6, fact: 'The smallest and most enigmatic baleen whale — rarely seen alive at sea.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Pygmy_right_whale.png/640px-Pygmy_right_whale.png' },
  2440704: { common: 'Gray Whale', scientific: 'Eschrichtius robustus', color: '#1a5276', emoji: '🐋', lengthM: 14, fact: 'Makes one of the longest migrations of any mammal — up to 12,000 miles round trip.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Ballena_gris_adulta_con_su_ballenato.jpg/640px-Ballena_gris_adulta_con_su_ballenato.jpg' },

  // ─── Sperm whales ────────────────────────────────────────────────────────
  8123917: { common: 'Sperm Whale', scientific: 'Physeter macrocephalus', color: '#1a5276', emoji: '🐋', lengthM: 18, fact: 'The deepest-diving mammal — capable of reaching 3km beneath the surface.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Mother_and_baby_sperm_whale.jpg/640px-Mother_and_baby_sperm_whale.jpg' },
  2440694: { common: 'Pygmy Sperm Whale', scientific: 'Kogia breviceps', color: '#1a5276', emoji: '🐋', lengthM: 3.5, fact: 'Releases a cloud of reddish-brown ink when startled — the only cetacean known to do so.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Pygmy_sperm_whale.jpg/640px-Pygmy_sperm_whale.jpg' },
  2440691: { common: 'Dwarf Sperm Whale', scientific: 'Kogia sima', color: '#1a5276', emoji: '🐋', lengthM: 2.7, fact: 'Smaller than most dolphins, yet shares the sperm whale\'s squared-off head and spermaceti organ.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Dwarf_sperm_whale_%28NOAA_Pitman%29.jpg' },

  // ─── Beaked whales ───────────────────────────────────────────────────────
  2440369: { common: 'Cuvier\'s Beaked Whale', scientific: 'Ziphius cavirostris', color: '#1a5276', emoji: '🐋', lengthM: 6.5, fact: 'Holds the record for the deepest and longest dive by a mammal — 3,000m for nearly 4 hours.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Ziphius_carvirostris.jpg/640px-Ziphius_carvirostris.jpg' },
  2440388: { common: 'Baird\'s Beaked Whale', scientific: 'Berardius bairdii', color: '#1a5276', emoji: '🐋', lengthM: 12, fact: 'The largest beaked whale at over 12 meters — hunted historically by Japanese coastal whalers.' },
  2440387: { common: 'Arnoux\'s Beaked Whale', scientific: 'Berardius arnuxii', color: '#1a5276', emoji: '🐋', lengthM: 10, fact: 'The Southern Hemisphere counterpart of Baird\'s beaked whale — rarely seen and poorly studied.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Berardius_arnuxii_2.jpg/640px-Berardius_arnuxii_2.jpg' },
  10084033: { common: 'Sato\'s Beaked Whale', scientific: 'Berardius minimus', color: '#1a5276', emoji: '🐋', lengthM: 7, fact: 'Described as a new species in 2019 — known to Japanese fishers as "karasu" (raven) for its dark color.' },
  5220013: { common: 'Northern Bottlenose Whale', scientific: 'Hyperoodon ampullatus', color: '#1a5276', emoji: '🐋', lengthM: 9, fact: 'So curious about ships that whalers could kill entire pods before any fled — a trait that nearly doomed them.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Hyperoodon_ampullatus_2.jpg/640px-Hyperoodon_ampullatus_2.jpg' },
  5220011: { common: 'Southern Bottlenose Whale', scientific: 'Hyperoodon planifrons', color: '#1a5276', emoji: '🐋', lengthM: 7.5, fact: 'One of the most frequently sighted beaked whales in Antarctic waters — often in groups of up to 25.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Hyperoodon_planifrons.jpg/640px-Hyperoodon_planifrons.jpg' },
  2440383: { common: 'Shepherd\'s Beaked Whale', scientific: 'Tasmacetus shepherdi', color: '#1a5276', emoji: '🐋', lengthM: 7, fact: 'Unique among beaked whales for retaining a full set of functional teeth in both jaws.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Tasmacetus_shepherdi.jpg/640px-Tasmacetus_shepherdi.jpg' },
  2440403: { common: 'Blainville\'s Beaked Whale', scientific: 'Mesoplodon densirostris', color: '#1a5276', emoji: '🐋', lengthM: 5, fact: 'Males sport bizarre barnacle-encrusted tusks erupting from a massive arch in the lower jaw.' },
  2440397: { common: 'Gervais\' Beaked Whale', scientific: 'Mesoplodon europaeus', color: '#1a5276', emoji: '🐋', lengthM: 5, fact: 'The most commonly stranded beaked whale in the North Atlantic — but almost never seen alive.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Mesoplodon_europaeus_2.jpg/640px-Mesoplodon_europaeus_2.jpg' },
  2440419: { common: 'Gray\'s Beaked Whale', scientific: 'Mesoplodon grayi', color: '#1a5276', emoji: '🐋', lengthM: 5.5, fact: 'One of the most commonly stranded beaked whales in New Zealand — unusually gregarious for its genus.' },
  2440394: { common: 'Hector\'s Beaked Whale', scientific: 'Mesoplodon hectori', color: '#1a5276', emoji: '🐋', lengthM: 4.5, fact: 'One of the smallest and rarest beaked whales — known almost entirely from strandings.' },
  2440401: { common: 'Hubb\'s Beaked Whale', scientific: 'Mesoplodon carlhubbsi', color: '#1a5276', emoji: '🐋', lengthM: 5.3, fact: 'Recognized by a dramatic white "cap" on the head — most sightings are in deep waters off Japan.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Mesoplodon_carlhubbsi.jpg/640px-Mesoplodon_carlhubbsi.jpg' },
  2440391: { common: 'Longman\'s Beaked Whale', scientific: 'Indopacetus pacificus', color: '#1a5276', emoji: '🐋', lengthM: 6, fact: 'Known only from two skulls for over a century until finally photographed alive in the tropical Pacific.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Indopacetus_pacificus_2.jpg/640px-Indopacetus_pacificus_2.jpg' },
  2440418: { common: 'Perrin\'s Beaked Whale', scientific: 'Mesoplodon perrini', color: '#1a5276', emoji: '🐋', lengthM: 4.5, fact: 'Described in 2002 — known from only a handful of specimens washed ashore in California.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Mesoplodon_perrini.jpg/640px-Mesoplodon_perrini.jpg' },
  2440406: { common: 'Pygmy Beaked Whale', scientific: 'Mesoplodon peruvianus', color: '#1a5276', emoji: '🐋', lengthM: 3.7, fact: 'The smallest beaked whale at under 4 meters — rarely observed and almost unknown in life.' },
  2440412: { common: 'Sowerby\'s Beaked Whale', scientific: 'Mesoplodon bidens', color: '#1a5276', emoji: '🐋', lengthM: 5, fact: 'The first beaked whale ever described — from a specimen stranded in Scotland in 1800.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Mesoplodon_bidens_2.jpg/640px-Mesoplodon_bidens_2.jpg' },
  2440407: { common: 'Spade-toothed Whale', scientific: 'Mesoplodon traversii', color: '#1a5276', emoji: '🐋', lengthM: 5.5, fact: 'The rarest whale on Earth — never confirmed alive, known from only three partial strandings.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Mesoplodon_traversii_2.jpg/640px-Mesoplodon_traversii_2.jpg' },
  2440402: { common: 'Stejneger\'s Beaked Whale', scientific: 'Mesoplodon stejnegeri', color: '#1a5276', emoji: '🐋', lengthM: 5.5, fact: 'A cold-water specialist of the North Pacific — sometimes found trapped in sea ice.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Mesoplodon_stejnegeri.jpg/640px-Mesoplodon_stejnegeri.jpg' },
  2440423: { common: 'Strap-toothed Whale', scientific: 'Mesoplodon layardii', color: '#1a5276', emoji: '🐋', lengthM: 6, fact: 'Males grow extraordinary tusks that curl over the upper jaw, eventually preventing it from opening wide.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Mesoplodon_layardii.jpg/640px-Mesoplodon_layardii.jpg' },
  2440417: { common: 'True\'s Beaked Whale', scientific: 'Mesoplodon mirus', color: '#1a5276', emoji: '🐋', lengthM: 5.4, fact: 'Remarkably, populations exist in both the North Atlantic and Indian Ocean — separated by thousands of miles.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/The_True%27s_beaked_whale_photographed_underwater.jpg/640px-The_True%27s_beaked_whale_photographed_underwater.jpg' },
  2440422: { common: 'Andrew\'s Beaked Whale', scientific: 'Mesoplodon bowdoini', color: '#1a5276', emoji: '🐋', lengthM: 4.5, fact: 'Known almost entirely from strandings in Australia and New Zealand — one of the least-known cetaceans.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Mesoplodon_bowdoini.jpg/640px-Mesoplodon_bowdoini.jpg' },
  2440411: { common: 'Deraniyagala\'s Beaked Whale', scientific: 'Mesoplodon hotaula', color: '#1a5276', emoji: '🐋', lengthM: 5, fact: 'Only distinguished as a separate species in 2014 from specimens in the warm Indo-Pacific.' },
  2440410: { common: 'Ginkgo-toothed Beaked Whale', scientific: 'Mesoplodon ginkgodens', color: '#1a5276', emoji: '🐋', lengthM: 5, fact: 'Named for the ginkgo-leaf shape of its teeth — known from fewer than 30 strandings worldwide.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Mesoplodon_ginkgodens_2.jpg/640px-Mesoplodon_ginkgodens_2.jpg' },

  // ─── Narwhal & Beluga ────────────────────────────────────────────────────
  5220008: { common: 'Narwhal', scientific: 'Monodon monoceros', color: '#1a5276', emoji: '🐋', lengthM: 5, fact: 'The male\'s spiraling tusk is actually a sensory organ — an inside-out tooth with millions of nerve endings.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/%D0%9D%D0%B0%D1%80%D0%B2%D0%B0%D0%BB_%D0%B2_%D1%80%D0%BE%D1%81%D1%81%D0%B8%D0%B9%D1%81%D0%BA%D0%BE%D0%B9_%D0%90%D1%80%D0%BA%D1%82%D0%B8%D0%BA%D0%B5.jpg/640px-%D0%9D%D0%B0%D1%80%D0%B2%D0%B0%D0%BB_%D0%B2_%D1%80%D0%BE%D1%81%D1%81%D0%B8%D0%B9%D1%81%D0%BA%D0%BE%D0%B9_%D0%90%D1%80%D0%BA%D1%82%D0%B8%D0%BA%D0%B5.jpg' },
  5220003: { common: 'Beluga', scientific: 'Delphinapterus leucas', color: '#1a5276', emoji: '🐋', lengthM: 4.5, fact: 'Called "the canary of the sea" for their rich vocal repertoire — one of the few whales with a flexible neck.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Oceanogr%C3%A0fic_29102004.jpg/640px-Oceanogr%C3%A0fic_29102004.jpg' },

  // ─── Oceanic dolphins ────────────────────────────────────────────────────
  2440483: { common: 'Orca', scientific: 'Orcinus orca', color: '#1a5276', emoji: '🐬', lengthM: 8, fact: 'Apex predators that live in tight-knit family pods with their own distinct dialects.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Killerwhales_jumping.jpg/640px-Killerwhales_jumping.jpg' },
  2440605: { common: 'Short-finned Pilot Whale', scientific: 'Globicephala macrorhynchus', color: '#1a5276', emoji: '🐋', lengthM: 5.5, fact: 'Lives in stable matrilineal groups — post-menopausal females lead the pod to food.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Globicephala_macrorhynchus_Kurzflossen-Grindwal_DSCF8148.JPG/640px-Globicephala_macrorhynchus_Kurzflossen-Grindwal_DSCF8148.JPG' },
  2440596: { common: 'Long-finned Pilot Whale', scientific: 'Globicephala melas', color: '#1a5276', emoji: '🐋', lengthM: 6, fact: 'Among the most frequently mass-stranded cetaceans — strong social bonds keep them together even in death.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Pilot_Whale_-_Flickr_-_gailhampshire.jpg/640px-Pilot_Whale_-_Flickr_-_gailhampshire.jpg' },
  2440440: { common: 'False Killer Whale', scientific: 'Pseudorca crassidens', color: '#1a5276', emoji: '🐬', lengthM: 5.5, fact: 'Known for offering fish to human divers — a rare display of interspecies generosity.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Pseudoorca_Crassidens_-_False_Killer_Whale.jpg/640px-Pseudoorca_Crassidens_-_False_Killer_Whale.jpg' },
  2440530: { common: 'Pygmy Killer Whale', scientific: 'Feresa attenuata', color: '#1a5276', emoji: '🐬', lengthM: 2.4, fact: 'Aggressive toward other dolphins despite its small size — one of the least studied oceanic dolphins.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Pygmy_killer_whales_%28Feresa_attenuata%29_off_of_Guam_%28anim252384854%29.jpg/640px-Pygmy_killer_whales_%28Feresa_attenuata%29_off_of_Guam_%28anim252384854%29.jpg' },
  2440470: { common: 'Melon-headed Whale', scientific: 'Peponocephala electra', color: '#1a5276', emoji: '🐬', lengthM: 2.7, fact: 'Travels in enormous herds of hundreds — often mistaken for pygmy killer whales at a distance.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Peponocephala_electra_Mayotte.jpg/640px-Peponocephala_electra_Mayotte.jpg' },
  2440460: { common: 'Irrawaddy Dolphin', scientific: 'Orcaella brevirostris', color: '#1a5276', emoji: '🐬', lengthM: 2.3, fact: 'Cooperates with fishers in Myanmar — driving fish into nets and receiving a share of the catch.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Irrawaddy_dolphin-Orcaella_brevirostris_by_2eight.jpg/640px-Irrawaddy_dolphin-Orcaella_brevirostris_by_2eight.jpg' },
  2440459: { common: 'Australian Snubfin Dolphin', scientific: 'Orcaella heinsohni', color: '#1a5276', emoji: '🐬', lengthM: 2.3, fact: 'Only described as a distinct species in 2005 — spits jets of water to herd fish.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Snubfin-3.jpg/640px-Snubfin-3.jpg' },
  2440447: { common: 'Bottlenose Dolphin', scientific: 'Tursiops truncatus', color: '#1a5276', emoji: '🐬', lengthM: 3, fact: 'Individuals can be tracked for decades by their unique dorsal fins. Some live past 60.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Tursiops_truncatus_01-cropped.jpg/640px-Tursiops_truncatus_01-cropped.jpg' },
  2440455: { common: 'Indo-Pacific Bottlenose Dolphin', scientific: 'Tursiops aduncus', color: '#1a5276', emoji: '🐬', lengthM: 2.6, fact: 'Uses sponges as foraging tools — one of the best-documented examples of animal tool use.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Tursiops_aduncus%2C_Port_River%2C_Adelaide%2C_Australia_-_2003.jpg/640px-Tursiops_aduncus%2C_Port_River%2C_Adelaide%2C_Australia_-_2003.jpg' },
  5846985: { common: 'Burrunan Dolphin', scientific: 'Tursiops australis', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'Only described in 2011 — found exclusively in two small populations in southern Australia.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Burrunan_Dolphin_%28Tursiops_australis%29-B.png/640px-Burrunan_Dolphin_%28Tursiops_australis%29-B.png' },
  8324617: { common: 'Common Dolphin', scientific: 'Delphinus delphis', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'Often travels in superpods of thousands — some of the most spectacular wildlife events on Earth.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Common_dolphin_noaa.jpg/640px-Common_dolphin_noaa.jpg' },
  2440647: { common: 'Long-beaked Common Dolphin', scientific: 'Delphinus capensis', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'Once considered a separate species, now debated — prefers shallower coastal waters than its short-beaked relative.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Common_dolphin_noaa.jpg/640px-Common_dolphin_noaa.jpg' },
  2440433: { common: 'Rough-toothed Dolphin', scientific: 'Steno bredanensis', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'Unusually eel-like swimming style — glides just beneath the surface with its head partially exposed.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Rough_toothed_dolphin.jpg/640px-Rough_toothed_dolphin.jpg' },
  5220055: { common: 'Striped Dolphin', scientific: 'Stenella coeruleoalba', color: '#1a5276', emoji: '🐬', lengthM: 2.4, fact: 'Performs spectacular roto-tailing — spinning on its tail axis while leaping up to 7 meters high.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Stenella_coeruleoalba_Ligurian_Sea_02_-_brighter.jpg/640px-Stenella_coeruleoalba_Ligurian_Sea_02_-_brighter.jpg' },
  5220045: { common: 'Atlantic Spotted Dolphin', scientific: 'Stenella frontalis', color: '#1a5276', emoji: '🐬', lengthM: 2.3, fact: 'Born without spots — they accumulate them with age until older adults are nearly white.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Atlantic_spotted_dolphin_%28Stenella_frontalis%29_NOAA.jpg/640px-Atlantic_spotted_dolphin_%28Stenella_frontalis%29_NOAA.jpg' },
  5220050: { common: 'Pantropical Spotted Dolphin', scientific: 'Stenella attenuata', color: '#1a5276', emoji: '🐬', lengthM: 2.2, fact: 'Millions were killed as bycatch in tuna purse-seine nets — driving major fishing reforms.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Pantropical_spotted_dolphin_swimming_off_the_coast_of_Costa_Rica.jpg/640px-Pantropical_spotted_dolphin_swimming_off_the_coast_of_Costa_Rica.jpg' },
  5220060: { common: 'Spinner Dolphin', scientific: 'Stenella longirostris', color: '#1a5276', emoji: '🐬', lengthM: 2, fact: 'Can spin up to 7 times in a single leap — thought to be a form of social communication.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/A_spinner_dolphin_in_the_Red_Sea.jpg/640px-A_spinner_dolphin_in_the_Red_Sea.jpg' },
  5220064: { common: 'Clymene Dolphin', scientific: 'Stenella clymene', color: '#1a5276', emoji: '🐬', lengthM: 1.9, fact: 'The only known cetacean of hybrid origin — a natural cross between spinner and striped dolphins.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Clymenes.jpg/640px-Clymenes.jpg' },
  2440493: { common: 'Fraser\'s Dolphin', scientific: 'Lagenodelphis hosei', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'Was described from a skeleton in 1956 but not seen alive until 1971 — often travels in pods of hundreds.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Frazer%C2%B4s_dolphin_group.jpg/640px-Frazer%C2%B4s_dolphin_group.jpg' },
  5220027: { common: 'Risso\'s Dolphin', scientific: 'Grampus griseus', color: '#1a5276', emoji: '🐬', lengthM: 3.5, fact: 'Born dark gray but accumulates scars from squid and other dolphins until nearly white with age.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Grampo.jpg/640px-Grampo.jpg' },
  5220069: { common: 'Pacific White-sided Dolphin', scientific: 'Lagenorhynchus obliquidens', color: '#1a5276', emoji: '🐬', lengthM: 2.3, fact: 'Acrobatic and energetic — they frequently bowride vessels for miles at a time.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Pacific_white-sided_dolphins_%28Lagenorhynchus_obliquidens%29_NOAA.jpg/640px-Pacific_white-sided_dolphins_%28Lagenorhynchus_obliquidens%29_NOAA.jpg' },
  5220073: { common: 'Atlantic White-sided Dolphin', scientific: 'Lagenorhynchus acutus', color: '#1a5276', emoji: '🐬', lengthM: 2.7, fact: 'Features a striking yellow-ochre blaze along its flank — common in the cold North Atlantic.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Atlantic_white-sided_dolphin.jpg/640px-Atlantic_white-sided_dolphin.jpg' },
  5220081: { common: 'White-beaked Dolphin', scientific: 'Lagenorhynchus albirostris', color: '#1a5276', emoji: '🐬', lengthM: 2.8, fact: 'The most northerly dolphin species — thrives in near-freezing subarctic waters.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/White-beaked_dolphins_%28Lagenorhynchus_albirostris%29_bow-riding_Eyjafjordur.jpg/640px-White-beaked_dolphins_%28Lagenorhynchus_albirostris%29_bow-riding_Eyjafjordur.jpg' },
  5220077: { common: 'Dusky Dolphin', scientific: 'Lagenorhynchus obscurus', color: '#1a5276', emoji: '🐬', lengthM: 2, fact: 'One of the most acrobatic cetaceans — performs coordinated leaps in groups while herding prey.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/DuskyDolphin.jpg/640px-DuskyDolphin.jpg' },
  5220066: { common: 'Hourglass Dolphin', scientific: 'Lagenorhynchus cruciger', color: '#1a5276', emoji: '🐬', lengthM: 1.8, fact: 'The only small dolphin found in Antarctic waters — named for its distinctive black-and-white pattern.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Hourglas_dolphin.jpg/640px-Hourglas_dolphin.jpg' },
  5220072: { common: 'Peale\'s Dolphin', scientific: 'Lagenorhynchus australis', color: '#1a5276', emoji: '🐬', lengthM: 2.2, fact: 'A kelp-forest specialist found in the fjords and channels of southern South America.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Peale%27s_dolphin_%28Sagmatias_australis%29_off_the_coast_of_Calbuco%2C_Chile_%28380921709%29.jpg/640px-Peale%27s_dolphin_%28Sagmatias_australis%29_off_the_coast_of_Calbuco%2C_Chile_%28380921709%29.jpg' },
  2440464: { common: 'Southern Right Whale Dolphin', scientific: 'Lissodelphis peronii', color: '#1a5276', emoji: '🐬', lengthM: 2.3, fact: 'Completely lacks a dorsal fin — the only finless dolphin in the Southern Hemisphere.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Lissodelphis_peronii_1847.jpg/640px-Lissodelphis_peronii_1847.jpg' },
  2440467: { common: 'Northern Right Whale Dolphin', scientific: 'Lissodelphis borealis', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'The sleekest cetacean — no dorsal fin, built for speed with a jet-black body and white belly flash.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Anim1749_-_Flickr_-_NOAA_Photo_Library.jpg/640px-Anim1749_-_Flickr_-_NOAA_Photo_Library.jpg' },
  8697392: { common: 'Commerson\'s Dolphin', scientific: 'Cephalorhynchus commersonii', color: '#1a5276', emoji: '🐬', lengthM: 1.5, fact: 'Striking black-and-white patterning resembles an orca in miniature — rarely exceeds 1.5 meters.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Tonina1_%282731842634%29.jpg/640px-Tonina1_%282731842634%29.jpg' },
  5220042: { common: 'Chilean Dolphin', scientific: 'Cephalorhynchus eutropia', color: '#1a5276', emoji: '🐬', lengthM: 1.7, fact: 'One of the smallest cetaceans — found only along the coast of Chile and called "tonina" locally.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Black_dolphins_around_isla_gordon.jpg/640px-Black_dolphins_around_isla_gordon.jpg' },
  5220041: { common: 'Heaviside\'s Dolphin', scientific: 'Cephalorhynchus heavisidii', color: '#1a5276', emoji: '🐬', lengthM: 1.7, fact: 'Endemic to the cold Benguela Current off southwestern Africa — leaps with distinctive flat splashes.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Dolphins_at_L%C3%BCderitz%2C_Namibia_%283144863196%29.jpg/640px-Dolphins_at_L%C3%BCderitz%2C_Namibia_%283144863196%29.jpg' },
  5220033: { common: 'Hector\'s Dolphin', scientific: 'Cephalorhynchus hectori', color: '#c87060', emoji: '🐬', lengthM: 1.4, fact: 'One of the world\'s smallest dolphins — found only in New Zealand\'s coastal waters.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Hector%27s_Dolphins_at_Porpoise_Bay_1999_a_cropped.jpg/640px-Hector%27s_Dolphins_at_Porpoise_Bay_1999_a_cropped.jpg' },
  5220035: { common: 'Maui\'s Dolphin', scientific: 'Cephalorhynchus hectori maui', color: '#e06868', emoji: '🐬', lengthM: 1.4, fact: 'Critically endangered — fewer than 55 remain, making it the world\'s rarest marine dolphin.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6f/Two_Maui%27s_dolphins.jpg' },
  2440537: { common: 'Tucuxi', scientific: 'Sotalia fluviatilis', color: '#1a5276', emoji: '🐬', lengthM: 1.5, fact: 'Looks like a small bottlenose but is a true river dolphin — never ventures into salt water.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Sotalia_fluviatilis_Amazon_River_Dolphin.jpg/640px-Sotalia_fluviatilis_Amazon_River_Dolphin.jpg' },
  2440542: { common: 'Guiana Dolphin', scientific: 'Sotalia guianensis', color: '#1a5276', emoji: '🐬', lengthM: 2, fact: 'The tucuxi\'s coastal cousin — thrives in estuaries and bays along the South American coast.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Descri%C3%A7%C3%A3o_in%C3%ADcio_ou_comportamento.jpg/640px-Descri%C3%A7%C3%A3o_in%C3%ADcio_ou_comportamento.jpg' },
  2440495: { common: 'Indo-Pacific Humpback Dolphin', scientific: 'Sousa chinensis', color: '#1a5276', emoji: '🐬', lengthM: 2.8, fact: 'Turns bubblegum pink with age — the famous pink dolphins of Hong Kong Harbor.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Pink_Dolphin.JPG/640px-Pink_Dolphin.JPG' },
  2440505: { common: 'Atlantic Humpback Dolphin', scientific: 'Sousa teuszii', color: '#d08060', emoji: '🐬', lengthM: 2.5, fact: 'One of the most endangered dolphins in Africa — fewer than 3,000 remain along the west coast.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Sousa_teuszii1.jpg/640px-Sousa_teuszii1.jpg' },
  2440506: { common: 'Indian Ocean Humpback Dolphin', scientific: 'Sousa plumbea', color: '#1a5276', emoji: '🐬', lengthM: 2.8, fact: 'Features a distinctive fatty hump beneath its dorsal fin — unique among dolphins.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Dolphin-Musandam_2.jpg/640px-Dolphin-Musandam_2.jpg' },
  7679722: { common: 'Australian Humpback Dolphin', scientific: 'Sousa sahulensis', color: '#1a5276', emoji: '🐬', lengthM: 2.7, fact: 'Only recognized as a separate species in 2014 — inhabits shallow tropical waters of northern Australia.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Australian_humpback_dolphins%2C_Tin_Can_Bay%2C_2016.jpg/640px-Australian_humpback_dolphins%2C_Tin_Can_Bay%2C_2016.jpg' },

  // ─── River dolphins ──────────────────────────────────────────────────────
  2440314: { common: 'Amazon River Dolphin', scientific: 'Inia geoffrensis', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'The largest river dolphin — turns pink with age from blood vessels beneath thin skin and scarring.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Amazonas-Flussdelfin_Orinoko3.jpg/640px-Amazonas-Flussdelfin_Orinoko3.jpg' },
  4351461: { common: 'Orinoco River Dolphin', scientific: 'Inia humboldtiana', color: '#1a5276', emoji: '🐬', lengthM: 2.3, fact: 'Recently split from the Amazon river dolphin — identified as a distinct species in 2024.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Amazonas-Flussdelfin_Orinoko3.jpg/640px-Amazonas-Flussdelfin_Orinoko3.jpg' },
  4351467: { common: 'Bolivian River Dolphin', scientific: 'Inia boliviensis', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'Isolated from other river dolphins for millions of years by rapids on the Madeira River.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Inia_geoffrensis_boliviensis_9274062.jpg/640px-Inia_geoffrensis_boliviensis_9274062.jpg' },
  8039210: { common: 'Araguaian River Dolphin', scientific: 'Inia araguaiaensis', color: '#1a5276', emoji: '🐬', lengthM: 2.3, fact: 'Described as a new species in 2014 — inhabits the Araguaia–Tocantins river basin in Brazil.' },
  2440764: { common: 'South Asian River Dolphin', scientific: 'Platanista gangetica', color: '#1a5276', emoji: '🐬', lengthM: 2.5, fact: 'Effectively blind — navigates the murky Ganges and Indus entirely by echolocation.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Ganges_River_Dolphin_cropped.jpg/640px-Ganges_River_Dolphin_cropped.jpg' },
  5220001: { common: 'La Plata Dolphin', scientific: 'Pontoporia blainvillei', color: '#1a5276', emoji: '🐬', lengthM: 1.7, fact: 'The only "river dolphin" that actually lives in the ocean — found in coastal Atlantic waters.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Pontoporia_blainvillei_296896096.jpg/640px-Pontoporia_blainvillei_296896096.jpg' },
  2440328: { common: 'Baiji', scientific: 'Lipotes vexillifer', color: '#e06868', emoji: '🐬', lengthM: 2.3, fact: 'Functionally extinct — the first cetacean likely driven to extinction by human activity in modern times.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Baiji_1.jpg/640px-Baiji_1.jpg' },

  // ─── Porpoises ───────────────────────────────────────────────────────────
  2440669: { common: 'Harbor Porpoise', scientific: 'Phocoena phocoena', color: '#1a5276', emoji: '🐬', lengthM: 1.5, fact: 'One of the smallest cetaceans at 1.5 meters — its name comes from the Latin "porcus piscis" (pig fish).', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Ecomare_-_bruinvis_Michael_in_2015_%28bruinvis-michael2015-9313-sw%29.jpg/640px-Ecomare_-_bruinvis_Michael_in_2015_%28bruinvis-michael2015-9313-sw%29.jpg' },
  2440665: { common: 'Vaquita', scientific: 'Phocoena sinus', color: '#e06868', emoji: '🐬', lengthM: 1.4, fact: 'The world\'s most endangered marine mammal — fewer than 10 remain in the upper Gulf of California.' },
  2440679: { common: 'Spectacled Porpoise', scientific: 'Phocoena dioptrica', color: '#1a5276', emoji: '🐬', lengthM: 2.2, fact: 'Striking black-and-white coloration with a white-rimmed eye patch — rarely observed alive.' },
  2440666: { common: 'Burmeister\'s Porpoise', scientific: 'Phocoena spinipinnis', color: '#1a5276', emoji: '🐬', lengthM: 1.8, fact: 'Has uniquely spiny dorsal-fin tubercles and is notoriously hard to spot at sea.' },
  2440684: { common: 'Dall\'s Porpoise', scientific: 'Phocoenoides dalli', color: '#1a5276', emoji: '🐬', lengthM: 2, fact: 'The fastest porpoise — creates a distinctive "rooster tail" spray at speeds over 30 mph.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Phocoenoides_dalli_%28Dall%27s_porpoise%29.jpg/640px-Phocoenoides_dalli_%28Dall%27s_porpoise%29.jpg' },
  2440656: { common: 'Finless Porpoise', scientific: 'Neophocaena phocaenoides', color: '#1a5276', emoji: '🐬', lengthM: 1.6, fact: 'Completely lacks a dorsal fin — instead has a ridge of small bumps along its back.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Neophocaena_phocaenoides_-Miyajima_Aquarium_-Japan-8a.jpg/640px-Neophocaena_phocaenoides_-Miyajima_Aquarium_-Japan-8a.jpg' },
  4352040: { common: 'Indo-Pacific Finless Porpoise', scientific: 'Neophocaena asiaeorientalis', color: '#1a5276', emoji: '🐬', lengthM: 1.6, fact: 'The Yangtze population is critically endangered — one of the few freshwater-dwelling porpoises.' },
}


export function getSpeciesMeta(speciesKey) {
  return SPECIES_META[speciesKey] || null
}

// Reverse lookup: scientific name → GBIF species key (for iNat matching)
const _sciNameToKey = {}
for (const [key, meta] of Object.entries(SPECIES_META)) {
  _sciNameToKey[meta.scientific.toLowerCase()] = Number(key)
}
function gbifKeyFromScientific(sciName) {
  if (!sciName) return null
  return _sciNameToKey[sciName.toLowerCase()] || null
}

// ─── Bounding box ─────────────────────────────────────────────────────────────
function getBoundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)))
  return {
    minLat: (lat - latDelta).toFixed(5),
    maxLat: (lat + latDelta).toFixed(5),
    minLng: (lng - lngDelta).toFixed(5),
    maxLng: (lng + lngDelta).toFixed(5),
  }
}

// ─── Normalize GBIF occurrence ────────────────────────────────────────────────
function normalizeOccurrence(occ) {
  const speciesKey = occ.speciesKey || occ.taxonKey
  const meta = getSpeciesMeta(speciesKey)
  return {
    id: String(occ.key),
    speciesKey,
    common: meta?.common || occ.vernacularName || occ.species || occ.genus || 'Unknown cetacean',
    scientific: occ.species || occ.genus || '',
    color: meta?.color || '#1a5276',
    emoji: meta?.emoji || '🐋',
    fact: meta?.fact || null,
    speciesPhoto: meta?.photoUrl || null,
    lat: occ.decimalLatitude,
    lng: occ.decimalLongitude,
    date: occ.eventDate ? occ.eventDate.split('T')[0] : null,
    place: [occ.locality, occ.stateProvince, occ.country].filter(Boolean).join(', ') || null,
    observer: occ.recordedBy || occ.institutionCode || occ.datasetName || 'GBIF contributor',
    photos: (occ.media || []).filter(m => m.type === 'StillImage' && m.identifier).slice(0, 2).map(m => m.identifier),
    source: 'GBIF',
  }
}

// ─── Recent sightings (past N days) ──────────────────────────────────────────
export async function fetchRecentSightings({ lat, lng, radiusKm = 300, days = 90, limit = 200 }) {
  const bb = getBoundingBox(lat, lng, radiusKm)
  const d2 = new Date()
  const d1 = new Date(d2 - days * 86400000)
  const fmt = d => d.toISOString().split('T')[0]

  const params = new URLSearchParams({
    taxonKey: CETACEA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    eventDate: `${fmt(d1)},${fmt(d2)}`,
    limit: Math.min(limit, 300),
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
  const data = await res.json()

  return {
    total: data.count || 0,
    sightings: (data.results || [])
      .filter(o => o.decimalLatitude && o.decimalLongitude)
      .filter(o => o.datasetKey !== GBIF_INAT_DATASET)
      .map(normalizeOccurrence),
  }
}

// ─── Historical sightings for a specific month (all years) ───────────────────
export async function fetchMonthSightings({ lat, lng, radiusKm = 400, month, limit = 200 }) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: CETACEA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    month,
    limit: Math.min(limit, 300),
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
  const data = await res.json()

  return {
    total: data.count || 0,
    sightings: (data.results || []).filter(o => o.decimalLatitude && o.decimalLongitude).map(normalizeOccurrence),
  }
}

// ─── Seasonal pattern — monthly totals across all years ───────────────────────
export async function fetchSeasonalPattern({ lat, lng, radiusKm = 500, speciesKey = null }) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: speciesKey || CETACEA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    limit: '0',
    facet: 'month',
    'month.facetLimit': '12',
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF facets error: ${res.status}`)
  const data = await res.json()

  const monthFacet = (data.facets || []).find(f => f.field === 'MONTH')
  const counts = monthFacet?.counts || []

  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const found = counts.find(c => Number(c.name) === m)
    return { month: m, count: found ? found.count : 0 }
  })
}

// ─── Aggregate species from sightings ─────────────────────────────────────────
export function aggregateSpecies(sightings) {
  const map = {}
  for (const s of sightings) {
    const key = s.speciesKey || s.scientific || s.common
    if (!map[key]) {
      map[key] = {
        speciesKey: s.speciesKey || key,
        common: s.common,
        scientific: s.scientific,
        color: s.color,
        meta: getSpeciesMeta(s.speciesKey),
        count: 0,
        lastSeen: null,
        photos: [],
      }
    }
    map[key].count++
    if (!map[key].lastSeen || s.date > map[key].lastSeen) map[key].lastSeen = s.date
    if (s.photos.length > 0 && map[key].photos.length === 0) map[key].photos = s.photos
  }
  return Object.values(map).sort((a, b) => b.count - a.count)
}

// ─── Whale Museum Hotline (Pacific coast, open API) ───────────────────────────
export async function fetchHotlineSightings() {
  try {
    const res = await fetch(`${HOTLINE_API}/sightings?limit=100`)
    if (!res.ok) return []
    const data = await res.json()
    return (data || []).map(s => ({
      id: `hotline-${s.id}`,
      speciesKey: s.species || null,
      common: s.species || 'Unknown',
      scientific: '',
      color: '#1a5276',
      lat: parseFloat(s.latitude),
      lng: parseFloat(s.longitude),
      date: s.sighted_at ? s.sighted_at.split('T')[0] : null,
      place: s.location || null,
      observer: s.name || 'Whale Museum Hotline',
      photos: [],
      source: 'Hotline',
      quantity: s.quantity,
    })).filter(s => s.lat && s.lng && !isNaN(s.lat) && !isNaN(s.lng))
  } catch {
    return []
  }
}

// ─── iNaturalist sightings ───────────────────────────────────────────────────
function normalizeINatObservation(obs) {
  const coords = obs.geojson?.coordinates // [lng, lat]
  if (!coords) return null
  const sciName = obs.taxon?.name || ''
  const speciesKey = gbifKeyFromScientific(sciName)
  const meta = speciesKey ? getSpeciesMeta(speciesKey) : null
  const photo = obs.photos?.[0]?.url?.replace('square', 'medium') || null
  return {
    id: `inat-${obs.id}`,
    speciesKey: speciesKey || sciName || null,
    common: obs.taxon?.preferred_common_name || meta?.common || sciName || 'Unknown cetacean',
    scientific: sciName,
    color: meta?.color || '#1a5276',
    emoji: meta?.emoji || '🐋',
    fact: meta?.fact || null,
    speciesPhoto: meta?.photoUrl || null,
    lat: coords[1],
    lng: coords[0],
    date: obs.observed_on || null,
    place: obs.place_guess || null,
    observer: obs.user?.login || 'iNaturalist observer',
    photos: photo ? [photo] : [],
    source: 'iNaturalist',
  }
}

export async function fetchINatSightings({ lat, lng, radiusKm = 300, days = 90, limit = 200 }) {
  try {
    const d2 = new Date()
    const d1 = new Date(d2 - days * 86400000)
    const fmt = d => d.toISOString().split('T')[0]

    const params = new URLSearchParams({
      taxon_id: INAT_CETACEA_TAXON,
      lat,
      lng,
      radius: radiusKm,
      d1: fmt(d1),
      d2: fmt(d2),
      order_by: 'observed_on',
      per_page: Math.min(limit, 200),
      geo: 'true',
    })

    const res = await fetch(`${INAT_API}/observations?${params}`, {
      headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).map(normalizeINatObservation).filter(Boolean)
  } catch {
    return []
  }
}
