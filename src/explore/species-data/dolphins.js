export const GBIF_TAXON_KEY = 5314  // Delphinidae family
export const INAT_TAXON_ID = 41479  // Delphinidae on iNat

export const SPECIES_META = {
  // ─── Classic dolphins ──────────────────────────────────────────────────
  2440447: { common: 'Bottlenose Dolphin', scientific: 'Tursiops truncatus', color: '#1a7a8a', emoji: '🐬', lengthM: 3, fact: 'Individuals can be tracked for decades by their unique dorsal fins. Some live past 60.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/611231392/medium.jpg' },
  2440455: { common: 'Indo-Pacific Bottlenose Dolphin', scientific: 'Tursiops aduncus', color: '#1a7a8a', emoji: '🐬', lengthM: 2.6, fact: 'Uses sponges as foraging tools — one of the best-documented examples of animal tool use.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/70501058/medium.jpg' },
  8324617: { common: 'Common Dolphin', scientific: 'Delphinus delphis', color: '#1a7a8a', emoji: '🐬', lengthM: 2.5, fact: 'Often travels in superpods of thousands — some of the most spectacular wildlife events on Earth.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/5026344/medium.jpg' },

  // ─── Stenella (spotted & spinner dolphins) ─────────────────────────────
  5220060: { common: 'Spinner Dolphin', scientific: 'Stenella longirostris', color: '#1a7a8a', emoji: '🐬', lengthM: 2, fact: 'Can spin up to 7 times in a single leap — thought to be a form of social communication.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/83099258/medium.jpg' },
  5220055: { common: 'Striped Dolphin', scientific: 'Stenella coeruleoalba', color: '#1a7a8a', emoji: '🐬', lengthM: 2.4, fact: 'Performs spectacular roto-tailing — spinning on its tail axis while leaping up to 7 meters high.', photoUrl: 'https://static.inaturalist.org/photos/180465491/medium.jpeg' },
  5220045: { common: 'Atlantic Spotted Dolphin', scientific: 'Stenella frontalis', color: '#1a7a8a', emoji: '🐬', lengthM: 2.3, fact: 'Born without spots — they accumulate them with age until older adults are nearly white.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/159009687/medium.jpg' },
  5220050: { common: 'Pantropical Spotted Dolphin', scientific: 'Stenella attenuata', color: '#1a7a8a', emoji: '🐬', lengthM: 2.2, fact: 'Millions were killed as bycatch in tuna purse-seine nets — driving major fishing reforms.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/61633355/medium.jpg' },

  // ─── Other oceanic dolphins ────────────────────────────────────────────
  5220027: { common: 'Risso\'s Dolphin', scientific: 'Grampus griseus', color: '#1a7a8a', emoji: '🐬', lengthM: 3.5, fact: 'Born dark gray but accumulates scars from squid and other dolphins until nearly white with age.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/142809664/medium.jpg' },
  5220069: { common: 'Pacific White-sided Dolphin', scientific: 'Lagenorhynchus obliquidens', color: '#1a7a8a', emoji: '🐬', lengthM: 2.3, fact: 'Acrobatic and energetic — they frequently bowride vessels for miles at a time.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/49327875/medium.jpg' },
  2440433: { common: 'Rough-toothed Dolphin', scientific: 'Steno bredanensis', color: '#1a7a8a', emoji: '🐬', lengthM: 2.5, fact: 'Unusually eel-like swimming style — glides just beneath the surface with its head partially exposed.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/332308271/medium.jpg' },
  2440493: { common: 'Fraser\'s Dolphin', scientific: 'Lagenodelphis hosei', color: '#1a7a8a', emoji: '🐬', lengthM: 2.5, fact: 'Was described from a skeleton in 1956 but not seen alive until 1971 — often travels in pods of hundreds.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/435694706/medium.jpg' },
  5220077: { common: 'Dusky Dolphin', scientific: 'Lagenorhynchus obscurus', color: '#1a7a8a', emoji: '🐬', lengthM: 2, fact: 'One of the most acrobatic cetaceans — performs coordinated leaps in groups while herding prey.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1183970/medium.jpg' },

  // ─── Orca ──────────────────────────────────────────────────────────────
  2440483: { common: 'Orca', scientific: 'Orcinus orca', color: '#1a7a8a', emoji: '🐬', lengthM: 8, fact: 'Apex predators that live in tight-knit family pods with their own distinct dialects.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/223550594/medium.jpg' },

  // ─── Irrawaddy & snubfin ───────────────────────────────────────────────
  2440460: { common: 'Irrawaddy Dolphin', scientific: 'Orcaella brevirostris', color: '#1a7a8a', emoji: '🐬', lengthM: 2.3, fact: 'Cooperates with fishers in Myanmar — driving fish into nets and receiving a share of the catch.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/345657581/medium.jpeg' },

  // ─── Cephalorhynchus ───────────────────────────────────────────────────
  8697392: { common: 'Commerson\'s Dolphin', scientific: 'Cephalorhynchus commersonii', color: '#1a7a8a', emoji: '🐬', lengthM: 1.5, fact: 'Striking black-and-white patterning resembles an orca in miniature — rarely exceeds 1.5 meters.', photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/441842688/medium.jpg' },
  5220033: { common: 'Hector\'s Dolphin', scientific: 'Cephalorhynchus hectori', color: '#c87060', emoji: '🐬', lengthM: 1.4, fact: 'One of the world\'s smallest dolphins — found only in New Zealand\'s coastal waters.', photoUrl: 'https://static.inaturalist.org/photos/214535228/medium.jpg' },
}
