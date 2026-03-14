export const GBIF_TAXON_KEY = 121
export const INAT_TAXON_ID = 47273

export const SHARK_ORDER_KEYS = new Set([
  885,  // Lamniformes (Great White, Mako, Thresher, Basking)
  887,  // Carcharhiniformes (Tiger, Bull, Hammerheads, Reef)
  769,  // Orectolobiformes (Whale Shark, Nurse, Wobbegong)
  883,  // Squaliformes (Dogfish, Sleeper sharks)
  770,  // Hexanchiformes (Cow sharks, Frilled shark)
  886,  // Heterodontiformes (Bullhead sharks)
  767,  // Pristiophoriformes (Sawsharks)
  882,  // Squatiniformes (Angel sharks)
])

export function isShark(occ) {
  return SHARK_ORDER_KEYS.has(occ.orderKey)
}

export const SPECIES_META = {
  // ─── Order Lamniformes ────────────────────────────────────────────────────
  2420694: {
    common: 'Great White Shark', scientific: 'Carcharodon carcharias',
    color: '#d63031', emoji: '🦈', lengthM: 6,
    fact: 'Can detect a single drop of blood in 25 gallons of water and sense electric fields as faint as a half-billionth of a volt.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/150546290/medium.jpeg',
    iucn: 'VU',
  },
  5216248: {
    common: 'Shortfin Mako', scientific: 'Isurus oxyrinchus',
    color: '#e67e22', emoji: '🦈', lengthM: 3.8,
    fact: 'The fastest shark on Earth — capable of bursts exceeding 45 mph and leaping 20 feet out of the water.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/70551905/medium.jpg',
    iucn: 'EN',
  },
  5216258: {
    common: 'Longfin Mako', scientific: 'Isurus paucus',
    color: '#e67e22', emoji: '🦈', lengthM: 4.3,
    fact: 'Rarer and less studied than its shortfin cousin — distinguished by its long, broad pectoral fins.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/28758924/medium.jpg',
    iucn: 'EN',
  },
  2420726: {
    common: 'Basking Shark', scientific: 'Cetorhinus maximus',
    color: '#d63031', emoji: '🦈', lengthM: 12,
    fact: 'The second-largest fish on Earth — filters up to 2,000 tons of water per hour through its gaping jaws.',
    photoUrl: 'https://static.inaturalist.org/photos/310765197/medium.jpg',
    iucn: 'VU',
  },
  2420797: {
    common: 'Common Thresher Shark', scientific: 'Alopias vulpinus',
    color: '#d63031', emoji: '🦈', lengthM: 6,
    fact: 'Stuns prey by cracking its tail like a whip — generating one of the fastest strikes in the ocean.',
    photoUrl: 'https://static.inaturalist.org/photos/61205816/medium.jpg',
    iucn: 'VU',
  },
  2420809: {
    common: 'Pelagic Thresher', scientific: 'Alopias pelagicus',
    color: '#e67e22', emoji: '🦈', lengthM: 3.5,
    fact: 'The most oceanic thresher — rarely comes near shore and spends its life in the open Indo-Pacific.',
    photoUrl: 'https://static.inaturalist.org/photos/257429672/medium.jpg',
    iucn: 'EN',
  },
  // ─── Order Carcharhiniformes ───────────────────────────────────────────────
  2418234: {
    common: 'Tiger Shark', scientific: 'Galeocerdo cuvier',
    color: '#d63031', emoji: '🦈', lengthM: 5.5,
    fact: 'The ocean\'s garbage collectors — known to swallow license plates, tires, and even a suit of armor.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/19051907/medium.jpg',
    iucn: 'NT',
  },
  2418036: {
    common: 'Bull Shark', scientific: 'Carcharhinus leucas',
    color: '#d63031', emoji: '🦈', lengthM: 3.5,
    fact: 'The only shark that can survive indefinitely in freshwater — found in rivers up to 2,500 miles inland.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/351417931/medium.jpg',
    iucn: 'VU',
  },
  2418792: {
    common: 'Great Hammerhead', scientific: 'Sphyrna mokarran',
    color: '#e67e22', emoji: '🦈', lengthM: 6,
    fact: 'Its wide-set eyes give it 360° vertical vision — it can see above and below simultaneously.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/12399600/medium.jpg',
    iucn: 'CR',
  },
  2418789: {
    common: 'Scalloped Hammerhead', scientific: 'Sphyrna lewini',
    color: '#e67e22', emoji: '🦈', lengthM: 4.3,
    fact: 'Forms enormous schools of hundreds during the day — then disperses to hunt alone at night.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/224059254/medium.jpg',
    iucn: 'CR',
  },
  2418794: {
    common: 'Smooth Hammerhead', scientific: 'Sphyrna zygaena',
    color: '#e67e22', emoji: '🦈', lengthM: 4,
    fact: 'The most widely distributed hammerhead — found in temperate waters where others rarely venture.',
    photoUrl: 'https://static.inaturalist.org/photos/462644734/medium.jpg',
    iucn: 'VU',
  },
  2418052: {
    common: 'Oceanic Whitetip', scientific: 'Carcharhinus longimanus',
    color: '#e67e22', emoji: '🦈', lengthM: 4,
    fact: 'Once the most numerous large shark in the open ocean — now critically endangered after population collapse.',
    photoUrl: 'https://static.inaturalist.org/photos/21906877/medium.jpg',
    iucn: 'CR',
  },
  2417981: {
    common: 'Blacktip Reef Shark', scientific: 'Carcharhinus melanopterus',
    color: '#d63031', emoji: '🦈', lengthM: 1.8,
    fact: 'Identified by its distinctive black-tipped fins — one of the most commonly seen reef sharks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/405675476/medium.jpeg',
    iucn: 'VU',
  },
  2417970: {
    common: 'Blacktip Shark', scientific: 'Carcharhinus limbatus',
    color: '#d63031', emoji: '🦈', lengthM: 2.5,
    fact: 'Spins up through schools of fish and launches spiraling into the air — one of the most acrobatic sharks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/247619680/medium.jpg',
    iucn: 'NT',
  },
  2418054: {
    common: 'Whitetip Reef Shark', scientific: 'Triaenodon obesus',
    color: '#d63031', emoji: '🦈', lengthM: 2,
    fact: 'Packs cooperate to flush prey from coral crevices at night — one of the few truly social sharks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/29230134/medium.jpg',
    iucn: 'VU',
  },
  2417940: {
    common: 'Blue Shark', scientific: 'Prionace glauca',
    color: '#d63031', emoji: '🦈', lengthM: 3.8,
    fact: 'The most wide-ranging shark on Earth — regularly crosses ocean basins and can travel 1,000+ miles in weeks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/358688436/medium.jpg',
    iucn: 'NT',
  },
  2417919: {
    common: 'Lemon Shark', scientific: 'Negaprion brevirostris',
    color: '#d63031', emoji: '🦈', lengthM: 3.4,
    fact: 'Returns to the same nursery habitat year after year — strong site fidelity studied for decades.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/70552759/medium.jpg',
    iucn: 'VU',
  },
  2418059: {
    common: 'Caribbean Reef Shark', scientific: 'Carcharhinus perezi',
    color: '#d63031', emoji: '🦈', lengthM: 3,
    fact: 'Can enter a trance-like state when turned on its back — a behavior called tonic immobility.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/290208487/medium.jpg',
    iucn: 'EN',
  },
  2418095: {
    common: 'Silky Shark', scientific: 'Carcharhinus falciformis',
    color: '#d63031', emoji: '🦈', lengthM: 3.5,
    fact: 'One of the most abundant oceanic sharks — notorious for following fishing fleets for discarded bycatch.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/477653797/medium.jpg',
    iucn: 'VU',
  },
  2418005: {
    common: 'Dusky Shark', scientific: 'Carcharhinus obscurus',
    color: '#d63031', emoji: '🦈', lengthM: 4,
    fact: 'One of the slowest-maturing sharks — females don\'t reproduce until age 20 and gestate for 24 months.',
    photoUrl: 'https://static.inaturalist.org/photos/22033528/medium.jpg',
    iucn: 'EN',
  },
  // ─── Order Orectolobiformes ────────────────────────────────────────────────
  2417522: {
    common: 'Whale Shark', scientific: 'Rhincodon typus',
    color: '#d63031', emoji: '🦈', lengthM: 14,
    fact: 'The largest fish on Earth — each individual is identified by its unique spot pattern, like a fingerprint.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/519729370/medium.jpg',
    iucn: 'EN',
  },
  2417495: {
    common: 'Nurse Shark', scientific: 'Ginglymostoma cirratum',
    color: '#d63031', emoji: '🦈', lengthM: 3,
    fact: 'Can rest motionless on the seafloor for hours — able to pump water over its gills without swimming.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/55987882/medium.jpg',
    iucn: 'VU',
  },
  8493577: {
    common: 'Zebra Shark', scientific: 'Stegostoma tigrinum',
    color: '#d63031', emoji: '🦈', lengthM: 2.5,
    fact: 'Born with bold zebra stripes that fade into spots with age — the inspiration for its misleading scientific name.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/125113158/medium.jpg',
    iucn: 'EN',
  },
}
