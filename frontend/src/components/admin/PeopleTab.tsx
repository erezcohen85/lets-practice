import { useState, type FormEvent } from 'react'
import { downloadText } from '@/components/admin/download'
import { PeopleFilters } from '@/components/admin/PeopleFilters'
import { NO_FILTERS } from '@/components/admin/peopleQuery'
import { PersonRow } from '@/components/admin/PersonRow'
import { NativeSelect } from '@/components/structure/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { addPerson, changeCount, planOnRow, removePerson, rowState, setPersonPlan, undoPerson, viewPeople, viewPlans, type Draft } from '@/domain/adminDraft'
import { peopleCsv, csvFileName } from '@/domain/peopleCsv'
import { planCounts, queryPeople, signInText, type PeopleQuery } from '@/domain/peopleList'
import { type PlanId } from '@/domain/planLimits'
import { ActionIcon } from '@/components/ui/action-icon'
import { strings } from '@/strings'

const text = strings.admin

const labelClass = 'text-sm leading-[18px] font-semibold tracking-[0.04em] text-text-soft uppercase'

/**
 * Give someone a plan, then the list: search, filters, sort, the export and the rows. Everything staged here goes into the one draft
 * of the page; the filters only choose which rows show. The export is the saved data of the rows shown, not the draft.
 */
/** The plan a person's saved row says (not the staged one), for the "was" note of a changed row. */
const savedPlanOnRow = (draft: Draft, email: string) => {
  const saved = draft.saved.people.find((person) => person.email === email)
  return saved === undefined ? undefined : planOnRow(saved)
}

export function PeopleTab({
  draft,
  query,
  onQuery,
  onChange,
}: {
  draft: Draft
  query: PeopleQuery
  onQuery: (query: PeopleQuery) => void
  onChange: (update: (draft: Draft) => Draft) => void
}) {
  const [email, setEmail] = useState('')
  const [addPlanId, setAddPlanId] = useState<PlanId>('trial')
  const [addError, setAddError] = useState<string | null>(null)
  const [exported, setExported] = useState<string | null>(null)

  const plans = viewPlans(draft)
  const people = viewPeople(draft)
  const unsaved = new Set(people.filter((person) => rowState(draft, person.email) !== 'saved').map((person) => person.email))
  const shown = queryPeople(people, plans, query, unsaved)
  // The file has what is saved for the people shown: a new person has nothing saved yet, and a staged plan is not in it.
  const exportRows = shown.flatMap((person) => draft.saved.people.filter((saved) => saved.email === person.email))
  const now = new Date()

  const changeQuery = (change: Partial<PeopleQuery>) => {
    setExported(null)
    onQuery({ ...query, ...change })
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    const next = addPerson(draft, email, addPlanId)
    if ('error' in next) {
      setAddError(next.error === 'invalid' ? text.invalid : text.duplicate)
      return
    }
    setAddError(null)
    setEmail('')
    setAddPlanId('trial')
    onChange(() => next)
  }

  const exportCsv = () => {
    const names = Object.fromEntries(draft.saved.plans.map((plan) => [plan.id, plan.name]))
    const fileName = csvFileName(now)
    downloadText(peopleCsv(exportRows, names), fileName)
    setExported(text.exported(exportRows.length, fileName))
  }

  return (
    <>
      <p className="text-[15px] leading-[22px] text-text-soft">{text.peopleIntro}</p>

      <form onSubmit={add} noValidate className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-5">
        <h2 className="text-lg leading-[23px] font-semibold">{text.addTitle}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
            <label htmlFor="add-email" className={labelClass}>
              {text.emailLabel}
            </label>
            <Input
              id="add-email"
              type="email"
              dir="ltr"
              value={email}
              placeholder={text.emailPlaceholder}
              onChange={(event) => {
                setEmail(event.target.value)
                setAddError(null)
              }}
              className="h-12 rounded-lg bg-background px-3.5 text-base md:text-base"
            />
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-38">
            <label htmlFor="add-plan" className={labelClass}>
              {text.planLabel}
            </label>
            <NativeSelect id="add-plan" value={addPlanId} onChange={(event) => setAddPlanId(event.target.value as PlanId)} className="h-12 text-base">
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline" size="xl">
            <ActionIcon action="add" />
            {text.add}
          </Button>
        </div>
        {addError !== null && (
          <p role="alert" className="text-sm font-semibold text-problem">
            {addError}
          </p>
        )}
      </form>

      <PeopleFilters
        query={query}
        onQuery={changeQuery}
        counts={planCounts(people)}
        plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))}
        shown={shown.length}
        total={people.length}
        exportCount={exportRows.length}
        hasUnsaved={changeCount(draft) > 0}
        exportedMessage={exported}
        onExport={exportCsv}
        onClear={() => changeQuery(NO_FILTERS)}
      />

      {shown.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong px-5 py-8">
          <p className="text-[15px] text-text-soft">{text.noMatch}</p>
          <Button type="button" variant="outline" size="touch" onClick={() => changeQuery(NO_FILTERS)}>
            {text.clearFilters}
          </Button>
        </div>
      )}

      <ul aria-label={text.peopleList} className="flex flex-col gap-3">
        {shown.map((person) => (
          <PersonRow
            key={person.email}
            person={person}
            state={rowState(draft, person.email)}
            savedPlanName={draft.saved.plans.find((plan) => plan.id === savedPlanOnRow(draft, person.email))?.name ?? ''}
            plans={plans}
            plan={plans.find((plan) => plan.id === person.plan_id)!}
            signIn={signInText(person.last_sign_in_at, now)}
            thisYear={now.getFullYear()}
            onPlan={(plan) => onChange((d) => setPersonPlan(d, person.email, plan))}
            onRemove={() => onChange((d) => removePerson(d, person.email))}
            onUndo={() => onChange((d) => undoPerson(d, person.email))}
          />
        ))}
      </ul>
    </>
  )
}
