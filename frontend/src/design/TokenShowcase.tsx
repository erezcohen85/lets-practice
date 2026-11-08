import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { strings } from '@/strings'
import { varName } from './render'
import { tokens, type FlagName, type ThemeName } from './tokens'

// Not a product screen: a page to check the theme by eye (served at /tokens.html).
// Every colour here is a var(--lp-...) reference, never a literal value.

const v = (name: string): string => `var(${name})`

function readTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-start">{title}</h2>
      {children}
    </section>
  )
}

function VariableName({ name }: { name: string }) {
  return <code className="font-mono text-xs text-muted-foreground">{name}</code>
}

function Swatch({ role }: { role: string }) {
  const name = varName(role)
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-start">
      <div
        data-testid="swatch"
        className="h-14 rounded-md border border-border"
        style={{ backgroundColor: v(name) }}
      />
      <span className="text-sm font-medium">{role}</span>
      <VariableName name={name} />
    </div>
  )
}

function FlagChip({ flag }: { flag: FlagName }) {
  const bg = varName('flag', flag, 'bg')
  const text = varName('flag', flag, 'text')
  return (
    <div className="flex flex-col items-start gap-2">
      <span
        data-testid="flag-chip"
        className="rounded-full px-3 py-1 text-sm font-medium"
        style={{ backgroundColor: v(bg), color: v(text) }}
      >
        {strings.showcase.flags[flag]}
      </span>
      <VariableName name={bg} />
      <VariableName name={text} />
    </div>
  )
}

export function TokenShowcase() {
  const [theme, setTheme] = useState<ThemeName>(readTheme)

  function toggleTheme() {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
  }

  const colourRoles = Object.keys(tokens.color.dark)
  const flags = Object.keys(tokens.flags.dark) as FlagName[]
  const auroraStops = tokens.aurora.map((_, i) => v(`--lp-aurora-${i + 1}`)).join(', ')

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 ps-6 pe-6 pt-8 pb-16 text-start">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">{strings.showcase.title}</h1>
          <p className="text-muted-foreground">{strings.showcase.intro}</p>
          <p className="text-sm text-text-soft">{strings.showcase.themeNow[theme]}</p>
        </div>
        <Button onClick={toggleTheme}>
          {theme === 'dark' ? strings.showcase.toLight : strings.showcase.toDark}
        </Button>
      </header>

      <Section title={strings.showcase.sections.colours}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {colourRoles.map((role) => (
            <Swatch key={role} role={role} />
          ))}
        </div>
      </Section>

      <Section title={strings.showcase.sections.flags}>
        <div className="flex flex-wrap gap-6">
          {flags.map((flag) => (
            <FlagChip key={flag} flag={flag} />
          ))}
        </div>
      </Section>

      <Section title={strings.showcase.sections.aurora}>
        <div
          data-testid="aurora"
          className="h-16 rounded-lg"
          style={{ backgroundImage: `linear-gradient(90deg, ${auroraStops})` }}
        />
        <div className="flex flex-wrap gap-4">
          {tokens.aurora.map((_, i) => (
            <VariableName key={i} name={`--lp-aurora-${i + 1}`} />
          ))}
        </div>
      </Section>

      <Section title={strings.showcase.sections.paper}>
        <div
          data-testid="paper"
          className="flex flex-col gap-4 rounded-lg p-6"
          style={{ backgroundColor: v('--lp-paper'), color: v('--lp-ink') }}
        >
          <div
            className="relative h-24 w-64 max-w-full rounded-sm border-2"
            style={{ borderColor: v('--lp-ink') }}
          >
            <span className="absolute top-2 ps-2 text-sm font-medium">{strings.showcase.paperBar}</span>
            <span
              data-testid="paper-cursor"
              className="absolute inset-y-0 start-1/3 w-0.5"
              style={{ backgroundColor: v('--lp-paper-cursor') }}
            />
          </div>
          <p className="text-sm">{strings.showcase.paperNote}</p>
          <div className="flex flex-wrap gap-4">
            {(['--lp-paper-anchor', '--lp-paper-selected', '--lp-paper-moved'] as const).map((name) => (
              <span
                key={name}
                className="h-2 w-16 rounded-full"
                style={{ backgroundColor: v(name) }}
                title={name}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title={strings.showcase.sections.type}>
        <div className="flex flex-col gap-3">
          {Object.entries(tokens.font.size).map(([key, size]) => (
            <div key={key} className="flex flex-col gap-1 border-b border-border pb-3">
              <VariableName name={`--lp-text-${key} (${size}px)`} />
              <span style={{ fontSize: v(`--lp-text-${key}`) }}>{strings.showcase.typeSample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={strings.showcase.sections.radius}>
        <div className="flex flex-wrap gap-4">
          {Object.entries(tokens.radius).map(([key, size]) => (
            <div key={key} className="flex flex-col items-start gap-2">
              <div
                className="h-16 w-28 border bg-surface-2"
                style={{ borderRadius: v(`--lp-radius-${key}`), borderColor: v('--lp-border-strong') }}
              />
              <VariableName name={`--lp-radius-${key} (${size}px)`} />
            </div>
          ))}
        </div>
      </Section>

      <Section title={strings.showcase.sections.buttons}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{strings.showcase.buttonDefault}</Button>
          <Button variant="outline">{strings.showcase.buttonOutline}</Button>
        </div>
      </Section>
    </main>
  )
}

export default TokenShowcase
