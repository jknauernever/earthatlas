import s from './Panel.module.css'

/** A heading over a set of DatasetRows ("Ships", "Places", "Air"…). Props: title, children. */
export default function PanelGroup({ title, children }) {
  return (
    <section className={s.group} aria-label={title}>
      <h3 className={s.groupHead}>{title}</h3>
      {children}
    </section>
  )
}
