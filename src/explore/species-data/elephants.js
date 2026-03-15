export const GBIF_TAXON_KEY = 9427  // Elephantidae family
export const INAT_TAXON_ID = 43692  // Elephantidae on iNat

export const SPECIES_META = {
  // ─── Loxodonta africana (African Bush Elephant) ────────────────────────────
  2435350: {
    common: 'African Bush Elephant', scientific: 'Loxodonta africana',
    color: '#5a6e3e', emoji: '🐘',
    fact: 'The largest living land animal — bulls can weigh over 6 tonnes and their ears are shaped like the African continent.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/93674728/medium.jpg',
    iucn: 'EN',
  },

  // ─── Loxodonta cyclotis (African Forest Elephant) ──────────────────────────
  2435349: {
    common: 'African Forest Elephant', scientific: 'Loxodonta cyclotis',
    color: '#5a6e3e', emoji: '🐘',
    fact: 'Smaller and more elusive than their savanna cousins, forest elephants are critical seed dispersers — some trees depend entirely on them for regeneration.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/12833226/medium.jpeg',
    iucn: 'CR',
  },

  // ─── Elephas maximus (Asian Elephant) ──────────────────────────────────────
  5219461: {
    common: 'Asian Elephant', scientific: 'Elephas maximus',
    color: '#5a6e3e', emoji: '🐘',
    fact: 'Asian elephants have been partners in human civilizations for over 4,000 years and can recognize themselves in mirrors — a hallmark of self-awareness.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/2035244/medium.jpg',
    iucn: 'EN',
  },

  // ─── Subspecies ────────────────────────────────────────────────────────────
  5219462: {
    common: 'Indian Elephant', scientific: 'Elephas maximus indicus',
    color: '#5a6e3e', emoji: '🐘',
    fact: 'The most widespread Asian elephant subspecies, Indian elephants maintain complex social bonds and can communicate using infrasonic rumbles that travel several kilometres.',
    photoUrl: 'https://static.inaturalist.org/photos/179933037/medium.jpeg',
    iucn: 'EN',
  },
  7059260: {
    common: 'Sri Lankan Elephant', scientific: 'Elephas maximus maximus',
    color: '#5a6e3e', emoji: '🐘',
    fact: 'The largest of the Asian elephant subspecies, Sri Lankan elephants are notable for their unusually low rate of tusk development — only about 7% of males grow tusks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/59707367/medium.jpg',
    iucn: 'EN',
  },
  5219463: {
    common: 'Sumatran Elephant', scientific: 'Elephas maximus sumatranus',
    color: '#5a6e3e', emoji: '🐘',
    fact: 'The smallest Asian elephant subspecies, Sumatran elephants have lost over 70% of their habitat in one generation to palm oil plantations and deforestation.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/82302881/medium.jpg',
    iucn: 'CR',
  },
  // Borneo Elephant — no separate GBIF backbone key; observations fall under Elephas maximus (5219461)
  // Kept as a comment for reference: Elephas maximus borneensis
}
