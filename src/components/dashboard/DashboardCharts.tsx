import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DashboardSeriesPoint } from '@/lib/dashboard'

const compactMoney = (value: number) => new Intl.NumberFormat('en-NP', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const tooltipMoney = (value: number | string | undefined) => `Rs ${Number(value || 0).toLocaleString('en-NP', { maximumFractionDigits: 2 })}`

export function SalesPurchaseChart({ data }: { data: DashboardSeriesPoint[] }) {
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E2D8" />
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} minTickGap={18} />
      <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
      <Tooltip formatter={tooltipMoney} contentStyle={{ borderRadius: 8, borderColor: '#DDD6C8', fontSize: 12 }} />
      <Legend wrapperStyle={{ fontSize: 12 }} />
      <Bar dataKey="sales" name="Sales" fill="#20A35A" radius={[4, 4, 0, 0]} maxBarSize={24} />
      <Bar dataKey="purchases" name="Purchases" fill="#F97316" radius={[4, 4, 0, 0]} maxBarSize={24} />
    </BarChart>
  </ResponsiveContainer>
}

export function CashFlowChart({ data }: { data: DashboardSeriesPoint[] }) {
  return <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E2D8" />
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} minTickGap={18} />
      <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
      <Tooltip formatter={tooltipMoney} contentStyle={{ borderRadius: 8, borderColor: '#DDD6C8', fontSize: 12 }} />
      <Legend wrapperStyle={{ fontSize: 12 }} />
      <Line type="monotone" dataKey="inflow" name="Cash Inflow" stroke="#20A35A" strokeWidth={2} dot={false} />
      <Line type="monotone" dataKey="outflow" name="Cash Outflow" stroke="#EF4444" strokeWidth={2} dot={false} />
      <Line type="monotone" dataKey="net" name="Net Cash Flow" stroke="#2563EB" strokeWidth={2} dot={false} />
    </LineChart>
  </ResponsiveContainer>
}
