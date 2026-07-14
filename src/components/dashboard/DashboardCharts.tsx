import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DashboardSeriesPoint } from '@/lib/dashboard'

const compactMoney = (value: number) => new Intl.NumberFormat('en-NP', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const tooltipMoney = (value: number | string | undefined) => `Rs ${Number(value || 0).toLocaleString('en-NP', { maximumFractionDigits: 2 })}`

export function SalesPurchaseChart({ data }: { data: DashboardSeriesPoint[] }) {
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E2D8" />
      <XAxis dataKey="label" tick={{ fontSize: 12, fontFamily: 'IBM Plex Sans', fill: '#6F6A62' }} axisLine={false} tickLine={false} minTickGap={18} />
      <YAxis tickFormatter={compactMoney} tick={{ fontSize: 12, fontFamily: 'IBM Plex Sans', fill: '#6F6A62' }} axisLine={false} tickLine={false} />
      <Tooltip formatter={tooltipMoney} contentStyle={{ borderRadius: 6, borderColor: '#DDD6C8', fontFamily: 'IBM Plex Sans', fontSize: 12, boxShadow: '0 4px 12px rgba(27,42,74,0.08)' }} />
      <Legend wrapperStyle={{ fontFamily: 'IBM Plex Sans', fontSize: 12, paddingTop: 4 }} />
      <Bar dataKey="sales" name="Sales" fill="#2D5F4C" radius={[3, 3, 0, 0]} maxBarSize={24} />
      <Bar dataKey="purchases" name="Purchases" fill="#B5482E" radius={[3, 3, 0, 0]} maxBarSize={24} />
    </BarChart>
  </ResponsiveContainer>
}

export function CashFlowChart({ data }: { data: DashboardSeriesPoint[] }) {
  return <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E2D8" />
      <XAxis dataKey="label" tick={{ fontSize: 12, fontFamily: 'IBM Plex Sans', fill: '#6F6A62' }} axisLine={false} tickLine={false} minTickGap={18} />
      <YAxis tickFormatter={compactMoney} tick={{ fontSize: 12, fontFamily: 'IBM Plex Sans', fill: '#6F6A62' }} axisLine={false} tickLine={false} />
      <Tooltip formatter={tooltipMoney} contentStyle={{ borderRadius: 6, borderColor: '#DDD6C8', fontFamily: 'IBM Plex Sans', fontSize: 12, boxShadow: '0 4px 12px rgba(27,42,74,0.08)' }} />
      <Legend wrapperStyle={{ fontFamily: 'IBM Plex Sans', fontSize: 12, paddingTop: 4 }} />
      <Line type="monotone" dataKey="inflow" name="Cash Inflow" stroke="#2D5F4C" strokeWidth={2.25} dot={false} />
      <Line type="monotone" dataKey="outflow" name="Cash Outflow" stroke="#B5482E" strokeWidth={2.25} dot={false} />
      <Line type="monotone" dataKey="net" name="Net Cash Flow" stroke="#1B2A4A" strokeWidth={2.25} dot={false} />
    </LineChart>
  </ResponsiveContainer>
}
