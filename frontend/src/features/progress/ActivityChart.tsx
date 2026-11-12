import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayPoint } from '../../lib/types'

/** Minutes practised per day. Loaded lazily so Recharts stays out of the main bundle. */
export default function ActivityChart({ data, height = 220 }: { data: DayPoint[]; height?: number }) {
  const rows = data.map((d) => ({
    ...d,
    minutes: Math.round(d.seconds / 60),
    label: new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  }))
  return (
    <div role="img" aria-label={`Minutes practised per day over the last ${data.length} days`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--color-subtle)' }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--color-subtle)' }} />
          <Tooltip
            cursor={{ fill: 'var(--color-accent-soft)' }}
            contentStyle={{ borderRadius: 8, border: '1px solid var(--color-line)', fontSize: 12 }}
            formatter={(value) => [`${value} min`, 'Practice']}
          />
          <Bar dataKey="minutes" fill="var(--color-accent)" radius={[3, 3, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
