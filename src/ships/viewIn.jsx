// "View in" (Josh 2026-10-02): public ship pages on other sites, straight to the ship, no sign-in. Each link was opened and
// checked 2026-10-02 (EURODAM, SALISH SEA GLORY): MarineTraffic only by IMO (its MMSI URL lands on the general map),
// VesselFinder and MyShipTracking by MMSI. Skylight / Triton (sign-in only) and CRAVT (fishing vessels only) were dropped.
// Plain outbound links; nothing is fetched. Equasis is deliberately not offered (its terms).
export function viewInLinks({ mmsi, imo }) {
  const m = /^\d{9}$/.test(String(mmsi || '')) ? String(mmsi) : null
  const i = /^\d{7}$/.test(String(imo || '')) ? String(imo) : null
  return [
    i && ['MarineTraffic', `https://www.marinetraffic.com/en/ais/details/ships/imo:${i}`],
    m && ['VesselFinder', `https://www.vesselfinder.com/vessels/details/${m}`],
    m && ['MyShipTracking', `https://www.myshiptracking.com/vessels/mmsi-${m}`],
  ].filter(Boolean)
}

export function ViewIn({ mmsi, imo, styles }) {
  const links = viewInLinks({ mmsi, imo })
  if (!links.length) return null
  return (
    <div className={styles.viewIn}>
      <span className={styles.viewInLabel} title="This ship's public page on other ship-tracking sites">View in</span>
      {links.map(([label, href]) => (
        <a key={label} className={styles.sourceLink} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
      ))}
    </div>
  )
}
