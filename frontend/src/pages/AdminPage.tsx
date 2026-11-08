import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router'
import { PeopleTab } from '@/components/admin/PeopleTab'
import { DEFAULT_QUERY } from '@/components/admin/peopleQuery'
import { PlansTab } from '@/components/admin/PlansTab'
import { SaveBar } from '@/components/admin/SaveBar'
import { ConfirmQuestion } from '@/components/hub/ConfirmQuestion'
import { BackLink } from '@/components/shell/BackLink'
import { PageColumn } from '@/components/shell/PageColumn'
import { ErrorState, LoadingState } from '@/components/shell/StateCards'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { changeCount, confirmNeeded, startDraft, toChanges, validate, type Draft } from '@/domain/adminDraft'
import { type PeopleQuery } from '@/domain/peopleList'
import { type PlanId } from '@/domain/planLimits'
import { useClients } from '@/lib/clients'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.admin

type Tab = 'plans' | 'people'
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'plans', label: text.tabPlans },
  { id: 'people', label: text.tabPeople },
]

/** "Trial and Creator": the names of the plans a save pauses. */
function pausedNames(draft: Draft, ids: PlanId[]): string[] {
  return ids.map((id) => draft.saved.plans.find((plan) => plan.id === id)?.name ?? id)
}

/**
 * The admin hub: Plans and People under one staged draft and one Save changes (plans and usage limits). Nothing is saved until Save;
 * the draft survives a tab switch; Save checks the numbers, asks only for a removal or a pause, applies everything in one call and
 * reads the data again. Leaving with unsaved changes asks first.
 */
export function AdminPage() {
  const { data } = useClients()
  // undefined: not read yet.
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  // Bumped by Try again, to read once more.
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<Tab>('plans')
  const [openPlan, setOpenPlan] = useState<PlanId | null>('trial')
  const [query, setQuery] = useState<PeopleQuery>(DEFAULT_QUERY)
  // Set by a Save that found a number it could not save: the marks stay (and follow the draft) until Discard or a save.
  const [checked, setChecked] = useState(false)
  const [note, setNote] = useState<'saved' | 'failed' | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ plans: null, people: null })
  const leaving = useRef(false)

  useEffect(() => {
    let current = true
    data.adminOverview().then(
      (overview) => current && setDraft(startDraft(overview)),
      () => current && setLoadFailed(true),
    )
    return () => {
      current = false
    }
  }, [data, attempt])

  const count = draft === undefined ? 0 : changeCount(draft)
  const dirty = count > 0
  const problems = draft !== undefined && checked ? validate(draft) : []

  // Any way out of the page asks first while something is unsaved: a link or the back button here, the browser's own question for
  // a closed or reloaded tab.
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (!dirty) return
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [dirty])

  function change(update: (draft: Draft) => Draft) {
    setDraft((current) => current && update(current))
    setNote(null)
  }

  // Applies the whole draft, then reads the data again: what is shown is what is stored. A save that fails throws and keeps the draft.
  async function apply() {
    if (draft === undefined) return
    await data.saveAdminChanges(toChanges(draft))
    setChecked(false)
    setNote('saved')
    try {
      setDraft(startDraft(await data.adminOverview()))
    } catch {
      // It is saved, but the page cannot show it: start over with Try again.
      setDraft(undefined)
      setLoadFailed(true)
    }
  }

  async function run() {
    setSaving(true)
    try {
      await apply()
    } catch {
      setNote('failed')
    } finally {
      setSaving(false)
    }
  }

  function save() {
    if (draft === undefined) return
    setChecked(true)
    const found = validate(draft)
    if (found.length > 0) {
      setTab('plans')
      setOpenPlan(found[0]!.plan)
      return
    }
    const need = confirmNeeded(draft)
    if (need.removes > 0 || need.pauses.length > 0) setConfirming(true)
    else void run()
  }

  function discard() {
    if (draft === undefined) return
    setDraft(startDraft(draft.saved))
    setChecked(false)
    setNote(null)
  }

  function onTabKey(event: React.KeyboardEvent) {
    const at = TABS.findIndex((entry) => entry.id === tab)
    const next = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
    if (next === null) return
    event.preventDefault()
    const target = TABS[(next + TABS.length) % TABS.length]!.id
    setTab(target)
    tabRefs.current[target]?.focus()
  }

  const back = (
    <div>
      <BackLink to="/settings">{strings.common.settings}</BackLink>
    </div>
  )

  if (loadFailed) {
    return (
      <PageColumn width="narrow" className="gap-6">
        {back}
        <h1 className="text-4xl leading-[1.1] font-bold tracking-[-0.01em]">{text.title}</h1>
        <ErrorState
          title={text.loadErrorTitle}
          text={text.loadErrorText}
          actions={
            <Button
              size="xl"
              onClick={() => {
                setLoadFailed(false)
                setAttempt((value) => value + 1)
              }}
            >
              <ActionIcon action="retry" />
              {strings.common.retry}
            </Button>
          }
        />
      </PageColumn>
    )
  }

  if (draft === undefined) {
    return (
      <PageColumn width="narrow" className="gap-6">
        {back}
        <h1 className="text-4xl leading-[1.1] font-bold tracking-[-0.01em]">{text.title}</h1>
        <LoadingState message={text.loading} />
      </PageColumn>
    )
  }

  const message = problems.length > 0 ? text.bar.fix : note === 'failed' ? text.bar.failed : dirty ? text.bar.unsaved(count) : note === 'saved' ? text.bar.saved : text.bar.none
  const need = confirmNeeded(draft)

  return (
    <PageColumn width="narrow" className="gap-6">
      {back}
      <h1 className="text-4xl leading-[1.1] font-bold tracking-[-0.01em]">{text.title}</h1>

      <div role="tablist" aria-label={text.tabsLabel} onKeyDown={onTabKey} className="flex gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            ref={(element) => {
              tabRefs.current[entry.id] = element
            }}
            type="button"
            role="tab"
            id={`admin-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls="admin-panel"
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)}
            className={cn(
              'flex h-12 flex-1 items-center justify-center rounded-lg border text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              tab === entry.id ? 'border-primary-strong bg-surface-2 font-semibold text-foreground' : 'border-border font-medium text-text-soft hover:bg-surface',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <SaveBar message={message} tone={problems.length > 0 || note === 'failed' ? 'problem' : 'normal'} dirty={dirty} busy={saving} onDiscard={discard} onSave={save} />

      <div role="tabpanel" id="admin-panel" aria-labelledby={`admin-tab-${tab}`} className="flex flex-col gap-6">
        {tab === 'plans' ? (
          <PlansTab draft={draft} openPlan={openPlan} problems={problems} onOpen={setOpenPlan} onChange={change} />
        ) : (
          <PeopleTab draft={draft} query={query} onQuery={setQuery} onChange={change} />
        )}
      </div>

      <ConfirmQuestion
        open={confirming}
        onOpenChange={setConfirming}
        title={text.confirm.title(count)}
        description={[need.removes > 0 ? text.confirm.removes(need.removes) : null, need.pauses.length > 0 ? text.confirm.pauses(pausedNames(draft, need.pauses)) : null]
          .filter((part) => part !== null)
          .join(' ')}
        confirmLabel={text.confirm.save}
        cancelLabel={text.confirm.keepEditing}
        failedText={text.confirm.failed}
        onConfirm={apply}
      />

      <ConfirmQuestion
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && !leaving.current && blocker.state === 'blocked') blocker.reset()
        }}
        title={text.leave.title}
        description={text.leave.text(count)}
        confirmLabel={text.leave.leave}
        cancelLabel={text.leave.stay}
        failedText={text.leave.failed}
        destructive
        onConfirm={async () => {
          leaving.current = true
          if (blocker.state === 'blocked') blocker.proceed()
        }}
      />
    </PageColumn>
  )
}
