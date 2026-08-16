import { useEffect, useRef, useState } from 'react'
import { Delete } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Operator = '+' | '-' | '*' | '/'

function calculate(left: number, right: number, operator: Operator) {
  if (operator === '+') return left + right
  if (operator === '-') return left - right
  if (operator === '*') return left * right
  if (right === 0) throw new Error('Cannot divide by zero')
  return left / right
}

function resultText(value: number) {
  if (!Number.isFinite(value)) return 'Error'
  return String(Number(value.toPrecision(12)))
}

export function PopupCalculator({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [display, setDisplay] = useState('0')
  const [stored, setStored] = useState<number | null>(null)
  const [operator, setOperator] = useState<Operator | null>(null)
  const [replaceDisplay, setReplaceDisplay] = useState(true)
  const [error, setError] = useState('')
  const displayRef = useRef(display)
  displayRef.current = display

  const clear = () => { setDisplay('0'); setStored(null); setOperator(null); setReplaceDisplay(true); setError('') }
  const enter = (character: string) => {
    setError('')
    setDisplay(current => {
      if (character === '.') {
        if (!replaceDisplay && current.includes('.')) return current
        setReplaceDisplay(false)
        return replaceDisplay ? '0.' : `${current}.`
      }
      setReplaceDisplay(false)
      if (replaceDisplay || current === '0' || current === 'Error') return character
      return current.length < 16 ? `${current}${character}` : current
    })
  }
  const chooseOperator = (next: Operator) => {
    const current = Number(displayRef.current)
    if (!Number.isFinite(current)) return clear()
    try {
      const value = stored !== null && operator && !replaceDisplay ? calculate(stored, current, operator) : current
      setStored(value); setDisplay(resultText(value)); setOperator(next); setReplaceDisplay(true); setError('')
    } catch (caught) { setDisplay('Error'); setError(caught instanceof Error ? caught.message : 'Calculation error'); setStored(null); setOperator(null); setReplaceDisplay(true) }
  }
  const equals = () => {
    if (stored === null || !operator) return
    try {
      const value = calculate(stored, Number(displayRef.current), operator)
      setDisplay(resultText(value)); setStored(null); setOperator(null); setReplaceDisplay(true); setError('')
    } catch (caught) { setDisplay('Error'); setError(caught instanceof Error ? caught.message : 'Calculation error'); setStored(null); setOperator(null); setReplaceDisplay(true) }
  }
  const backspace = () => {
    setDisplay(current => current === 'Error' || current.length <= 1 || (current.length === 2 && current.startsWith('-')) ? '0' : current.slice(0, -1))
    setReplaceDisplay(false)
    setError('')
  }
  const toggleSign = () => setDisplay(current => current === '0' || current === 'Error' ? current : current.startsWith('-') ? current.slice(1) : `-${current}`)
  const percent = () => {
    const current = Number(displayRef.current) || 0
    try {
      if (stored !== null && operator) {
        const percentageValue = operator === '+' || operator === '-' ? stored * current / 100 : current / 100
        const value = calculate(stored, percentageValue, operator)
        setDisplay(resultText(value)); setStored(null); setOperator(null); setReplaceDisplay(true); setError('')
      } else {
        setDisplay(resultText(current / 100)); setReplaceDisplay(true); setError('')
      }
    } catch (caught) {
      setDisplay('Error'); setError(caught instanceof Error ? caught.message : 'Calculation error'); setStored(null); setOperator(null); setReplaceDisplay(true)
    }
  }

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); enter(event.key) }
      else if (event.key === '.') { event.preventDefault(); enter('.') }
      else if (['+', '-', '*', '/'].includes(event.key)) { event.preventDefault(); chooseOperator(event.key as Operator) }
      else if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); equals() }
      else if (event.key === 'Backspace') { event.preventDefault(); backspace() }
      else if (event.key === 'Delete') { event.preventDefault(); clear() }
      else if (event.key.toLowerCase() === 'c') { event.preventDefault(); clear() }
      else if (event.key === '%') { event.preventDefault(); percent() }
      else return
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  })

  const keys: Array<{ label: string; action: () => void; variant?: 'default' | 'outline' | 'secondary'; className?: string }> = [
    { label: 'C', action: clear, variant: 'outline' }, { label: '±', action: toggleSign, variant: 'outline' }, { label: '%', action: percent, variant: 'outline' }, { label: '÷', action: () => chooseOperator('/'), variant: 'secondary' },
    { label: '7', action: () => enter('7') }, { label: '8', action: () => enter('8') }, { label: '9', action: () => enter('9') }, { label: '×', action: () => chooseOperator('*'), variant: 'secondary' },
    { label: '4', action: () => enter('4') }, { label: '5', action: () => enter('5') }, { label: '6', action: () => enter('6') }, { label: '−', action: () => chooseOperator('-'), variant: 'secondary' },
    { label: '1', action: () => enter('1') }, { label: '2', action: () => enter('2') }, { label: '3', action: () => enter('3') }, { label: '+', action: () => chooseOperator('+'), variant: 'secondary' },
    { label: '0', action: () => enter('0'), className: 'col-span-2' }, { label: '.', action: () => enter('.') }, { label: '=', action: equals, variant: 'default' },
  ]
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-[20rem]" onOpenAutoFocus={event => event.preventDefault()}><DialogHeader><DialogTitle>Calculator</DialogTitle><DialogDescription>F2 to open · Esc to close · Enter for result</DialogDescription></DialogHeader><div className="rounded-md border bg-primary px-3 py-3 text-right text-primary-foreground"><div className="h-4 text-xs text-primary-foreground/65">{stored !== null && operator ? `${resultText(stored)} ${operator === '*' ? '×' : operator === '/' ? '÷' : operator}` : '\u00a0'}</div><output className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xl font-semibold tabular-nums" aria-live="polite">{display}</output></div>{error && <p className="text-xs text-destructive">{error}</p>}<div className="grid grid-cols-4 gap-2">{keys.map((key, index) => <Button key={`${key.label}-${index}`} type="button" variant={key.variant || 'outline'} className={`h-11 text-base ${key.className || ''}`} onClick={key.action}>{key.label}</Button>)}</div><Button type="button" variant="ghost" size="sm" onClick={backspace}><Delete className="mr-1.5 h-4 w-4" />Backspace</Button></DialogContent></Dialog>
}
