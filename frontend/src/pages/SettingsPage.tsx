import { useState } from 'react'
import { Link } from 'react-router'
import { ColourSwatches } from '@/components/settings/ColourSwatches'
import { SegmentedChoice, type Choice } from '@/components/settings/SegmentedChoice'
import { SettingSwitch } from '@/components/settings/SettingSwitch'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { useSettingsSaver } from '@/components/settings/useSettingsSaver'
import { DeleteAccountDialog } from '@/components/settings/DeleteAccountDialog'
import { BackLink } from '@/components/shell/BackLink'
import { PageColumn } from '@/components/shell/PageColumn'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { KeyboardShortcutsDialog, MORE_EDITOR_SHORTCUTS } from '@/components/settings/KeyboardShortcutsDialog'
import { type ContinueMode, type CursorColour, type FollowSettings, type UserSettings } from '@/lib/dataClient'
import { useSession } from '@/lib/session'
import { strings } from '@/strings'

const text = strings.settings

type Area = 'appearance' | 'editing' | 'following' | 'loop' | 'account'

const scrollChoices: Choice<FollowSettings['scroll']>[] = [
  { value: 'line', label: text.scrollByLine },
  { value: 'page', label: text.scrollByPage },
]

const continueChoices: Choice<ContinueMode>[] = [
  { value: 'ask', label: text.continueAsk },
  { value: 'button', label: text.continueButton },
  { value: 'auto', label: text.continueAuto },
]

/**
 * How the score follows the music, the night score, the bar numbers, what the Editor does by itself once bars are checked
 * by ear, the keys for hands free practice, and the account. Every change is saved at once; there is no Save button. The
 * route guard keeps visitors out, so this renders nothing for them.
 */
export function SettingsPage() {
  const { status, user, profile, saveSettings, signOut, deleteAccount } = useSession()
  if (status !== 'signed-in') return null
  return <SettingsForm email={user.email} isAdmin={profile.isAdmin} saved={profile.settings} save={saveSettings} signOut={signOut} deleteAccount={deleteAccount} />
}

function SettingsForm({
  email,
  isAdmin,
  saved,
  save,
  signOut,
  deleteAccount,
}: {
  email: string
  isAdmin: boolean
  saved: UserSettings
  save: (settings: UserSettings) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
}) {
  const { settings, change, failedIn } = useSettingsSaver<Area>(saved, save)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const changeFollow = (update: Partial<FollowSettings>) =>
    change('following', (current) => ({ ...current, follow: { ...current.follow, ...update } }))
  const { follow } = settings

  // Signing out ends the session, and the route guard then sends the visitor to the landing page.
  async function leave() {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      await signOut()
    } catch {
      setSignOutFailed(true)
      setSigningOut(false)
    }
  }

  const saveError = (area: Area) => (failedIn === area ? text.saveFailed : null)

  return (
    <PageColumn width="narrow" className="gap-6">
      <div>
        <BackLink />
      </div>
      <h1 className="text-4xl leading-[1.3] font-bold tracking-[-0.01em]">{text.title}</h1>

      <SettingsSection title={text.appearance} error={saveError('appearance')}>
        <SettingsRow label={text.lightMode} hint={text.lightModeHint}>
          {({ hintId }) => (
            <SettingSwitch
              aria-label={text.lightMode}
              aria-describedby={hintId}
              checked={settings.theme === 'light'}
              onCheckedChange={(light) => change('appearance', (current) => ({ ...current, theme: light ? 'light' : 'dark' }))}
            />
          )}
        </SettingsRow>
        <SettingsRow label={text.nightScore} hint={text.nightScoreHint}>
          {({ labelId, hintId }) => (
            <SettingSwitch
              aria-labelledby={labelId}
              aria-describedby={hintId}
              checked={settings.nightScore}
              onCheckedChange={(nightScore) => change('appearance', (current) => ({ ...current, nightScore }))}
            />
          )}
        </SettingsRow>
        <SettingsRow label={text.barNumbers} hint={text.barNumbersHint}>
          {({ labelId, hintId }) => (
            <SettingSwitch
              aria-labelledby={labelId}
              aria-describedby={hintId}
              checked={settings.barNumbers}
              onCheckedChange={(barNumbers) => change('appearance', (current) => ({ ...current, barNumbers }))}
            />
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={text.keyCommands}>
        <SettingsRow label={text.keyboardShortcuts} hint={text.shortcutsHint(MORE_EDITOR_SHORTCUTS)}>
          {() => (
            <Button variant="outline" size="touch" className="bg-surface-2 px-5 font-medium" onClick={() => setShortcutsOpen(true)}>
              {text.shortcutsShow}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <SettingsSection title={text.editing} error={saveError('editing')}>
        <SettingsRow label={text.continueMode} hint={text.continueModeHint} stacked="narrow">
          {({ labelId, hintId }) => (
            <SegmentedChoice
              labelledBy={labelId}
              describedBy={hintId}
              value={settings.continueMode}
              choices={continueChoices}
              onChange={(continueMode) => change('editing', (current) => ({ ...current, continueMode }))}
            />
          )}
        </SettingsRow>
        <SettingsRow label={text.autoRegrid} hint={text.autoRegridHint}>
          {({ labelId, hintId }) => (
            <SettingSwitch
              aria-labelledby={labelId}
              aria-describedby={hintId}
              checked={settings.autoRegrid}
              onCheckedChange={(autoRegrid) => change('editing', (current) => ({ ...current, autoRegrid }))}
            />
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={text.following} error={saveError('following')}>
        <SettingsRow label={text.scrolling}>
          {({ labelId }) => (
            <SegmentedChoice
              labelledBy={labelId}
              value={follow.scroll}
              choices={scrollChoices}
              onChange={(scroll) => changeFollow({ scroll })}
            />
          )}
        </SettingsRow>
        <FollowRow
          label={text.box}
          colourLabel={text.boxColours}
          on={follow.box}
          colour={follow.boxColour}
          onToggle={(box) => changeFollow({ box })}
          onColour={(boxColour) => changeFollow({ boxColour })}
        />
        <FollowRow
          label={text.line}
          colourLabel={text.lineColours}
          on={follow.line}
          colour={follow.lineColour}
          onToggle={(line) => changeFollow({ line })}
          onColour={(lineColour) => changeFollow({ lineColour })}
        />
      </SettingsSection>

      <SettingsSection title={text.loopSection} error={saveError('loop')}>
        <SettingsRow label={text.loop} hint={text.loopHint} stacked="narrow">
          {() => (
            <div className="flex items-center gap-4">
              <ColourSwatches
                label={text.loopColours}
                value={settings.loop.colour}
                onChange={(colour) => change('loop', (current) => ({ ...current, loop: { ...current.loop, colour } }))}
                dimmed={!settings.loop.show}
              />
              <SettingSwitch
                aria-label={text.loopShow}
                checked={settings.loop.show}
                onCheckedChange={(show) => change('loop', (current) => ({ ...current, loop: { ...current.loop, show } }))}
              />
            </div>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={text.handsFree}>
        <dl className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-5 py-4 text-base leading-[1.3]">
          {text.keys.map(({ action, keys }) => (
            <div key={action} className="flex justify-between gap-4">
              <dt>{action}</dt>
              <dd className="text-text-soft">{keys}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>

      <SettingsSection title={text.account} error={signOutFailed ? text.signOutFailed : null}>
        <SettingsRow label={email} hint={text.language}>
          {() => (
            <Button
              variant="outline"
              size="touch"
              className="px-5 font-medium dark:bg-transparent dark:hover:bg-muted"
              disabled={signingOut}
              onClick={leave}
            >
              {text.signOut}
            </Button>
          )}
        </SettingsRow>
        {isAdmin && (
          <Link to="/admin" className="inline-flex min-h-11 items-center self-start text-[15px] text-text-muted transition-colors hover:text-foreground">
            {text.admin}
          </Link>
        )}
        {isAdmin ? (
          <p className="rounded-lg border border-border bg-surface px-5 py-4 text-sm leading-[1.3] text-text-muted">{text.adminCannotDelete}</p>
        ) : (
          <SettingsRow label={text.deleteAccountLabel} hint={text.deleteAccountHint}>
            {() => (
              <Button variant="destructive" size="touch" className="px-5 font-medium" onClick={() => setDeleteOpen(true)}>
                <ActionIcon action="delete" />
                {text.deleteAccount}
              </Button>
            )}
          </SettingsRow>
        )}
        <Link to="/terms" className="inline-flex min-h-11 items-center self-start text-[15px] text-text-muted transition-colors hover:text-foreground">
          {text.terms}
        </Link>
      </SettingsSection>
      {!isAdmin && <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} onDelete={deleteAccount} />}
    </PageColumn>
  )
}

/** A feature of the cursor (the box, the gliding line): its colour, and a switch to have it or not. */
function FollowRow({
  label,
  colourLabel,
  on,
  colour,
  onToggle,
  onColour,
}: {
  label: string
  colourLabel: string
  on: boolean
  colour: CursorColour
  onToggle: (on: boolean) => void
  onColour: (colour: CursorColour) => void
}) {
  return (
    <SettingsRow label={label} stacked="narrow">
      {({ labelId }) => (
        <div className="flex items-center gap-4">
          <ColourSwatches label={colourLabel} value={colour} onChange={onColour} dimmed={!on} />
          <SettingSwitch aria-labelledby={labelId} checked={on} onCheckedChange={onToggle} />
        </div>
      )}
    </SettingsRow>
  )
}
