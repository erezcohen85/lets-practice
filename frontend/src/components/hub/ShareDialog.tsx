import { useEffect, useId, useState, type ComponentProps } from 'react'
import { ConfirmQuestion } from '@/components/hub/ConfirmQuestion'
import { quietActionClass } from '@/components/hub/styles'
import { SettingSwitch } from '@/components/settings/SettingSwitch'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { membersOnHold } from '@/domain/memberLimit'
import { useClients } from '@/lib/clients'
import { type MemberLimit, type PieceMember, type ShareLink } from '@/lib/dataClient'
import { usePlan, usePlanGate } from '@/lib/plan'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.share
const nameOf = (member: PieceMember) => member.displayName || member.email

/** The share dialog's questions: the shared question, in the share dialog's words. */
function Question(props: Omit<ComponentProps<typeof ConfirmQuestion>, 'cancelLabel' | 'failedText'>) {
  return <ConfirmQuestion cancelLabel={text.cancel} failedText={text.failed} {...props} />
}

/**
 * The body is its own component, so each time the dialog opens it starts empty and loads again: a link that could not be
 * loaded is never left over from an earlier opening. The two questions sit inside it too, so they open on top of this dialog.
 */
function ShareBody({ pieceId }: { pieceId: string }) {
  const { data } = useClients()
  const gate = usePlanGate()
  const { refresh: refreshPlan } = usePlan()
  const linkId = useId()
  const switchId = useId()
  // `limit` is null when it could not be read: the dialog then leaves out only the count line.
  const [loaded, setLoaded] = useState<{ share: ShareLink; members: PieceMember[]; limit: MemberLimit | null } | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)
  // The rights question, asked the first time the link is turned on; its tick starts empty each time it opens.
  const [askingRights, setAskingRights] = useState(false)
  const [rightsTicked, setRightsTicked] = useState(false)
  // The member the question names; kept after the question closes so its words do not empty while it fades out.
  const [removing, setRemoving] = useState<PieceMember | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  // Each change is saved at once. A failed one says so and leaves the screen as it was: state moves only after the save.
  // A change the plan refuses opens the "Not in your plan" prompt instead, and leaves the screen as it was too.
  const attempt = async (action: () => Promise<void>) => {
    setFailed(false)
    try {
      await gate.run(null, action)
    } catch {
      setFailed(true)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([data.getShare(pieceId), data.listMembers(pieceId), data.getMemberLimit(pieceId).catch(() => null)]).then(
      ([share, members, limit]) => {
        if (active) setLoaded({ share, members, limit })
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [data, pieceId])

  const share = loaded?.share ?? null
  const members = loaded?.members ?? []
  const limit = loaded?.limit ?? null
  const heldCount = members.filter((member) => member.onHold).length
  // Built from where the app is open now, never from a stored address.
  const url = share === null ? '' : `${window.location.origin}/join/${share.token}`

  return (
    <>
      <DialogHeader className="gap-2">
        <DialogTitle className="text-xl leading-tight font-semibold">{text.title}</DialogTitle>
        <DialogDescription className="text-[15px] text-text-soft">{text.explanation}</DialogDescription>
      </DialogHeader>
      {failed && (
        <p role="alert" className="text-sm text-problem">
          {text.failed}
        </p>
      )}
      {share === null ? (
        !failed && <p className="text-text-muted">{text.loading}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor={linkId} className="text-sm text-text-soft">
              {text.linkLabel}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={linkId}
                readOnly
                value={url}
                dir="ltr"
                className="h-11 min-w-0 flex-1 bg-background text-base md:text-base dark:bg-background"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                size="touch"
                className="px-5"
                onClick={() =>
                  void attempt(async () => {
                    await navigator.clipboard.writeText(url)
                    setCopied(true)
                  })
                }
              >
                <ActionIcon action={copied ? "confirm" : "copy"} />
                {copied ? text.copied : text.copy}
              </Button>
            </div>
            {!share.enabled && (
              <p role="status" className="text-sm text-text-muted">
                {text.linkOff}
              </p>
            )}
          </div>

          <div className="flex min-h-11 items-center justify-between gap-4">
            <Label htmlFor={switchId} className="text-base">
              {text.switchLabel}
            </Label>
            <SettingSwitch
              id={switchId}
              aria-label={text.switchLabel}
              checked={share.enabled}
              onCheckedChange={(on) => {
                // The plan is asked before anything else: a link the plan refuses is not worth the rights question. Off never asks.
                if (on && !gate.check({ type: 'shareOn' })) return
                // Turning it on for the first time asks first; the switch stays off until the question is answered.
                if (on && share.rightsConfirmedAt === null) {
                  setRightsTicked(false)
                  setAskingRights(true)
                  return
                }
                void attempt(async () => {
                  await data.setShareEnabled(pieceId, on)
                  setLoaded((now) => (now === null ? now : { ...now, share: { ...now.share, enabled: on } }))
                  void refreshPlan()
                })
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant="danger" size="touch" className="px-5 font-semibold" onClick={() => setResetting(true)}>
              <ActionIcon action="reset" />
              {text.reset}
            </Button>
            <p className="min-w-[200px] flex-1 text-sm leading-5 text-text-muted">{text.resetHint}</p>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-base font-semibold">{text.members}</h3>
            {limit !== null && <p className="text-[15px] text-text-soft">{text.memberCount(limit.count, limit.limit)}</p>}
            {limit !== null && heldCount > 0 && (
              <p role="status" className="text-[15px] text-text-soft">
                {text.overLimit(limit.limit, heldCount)}
              </p>
            )}
            {members.length === 0 ? (
              <p className="text-[15px] text-text-muted">{text.noMembers}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {members.map((member) => (
                  <li key={member.userId} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate font-medium">{nameOf(member)}</div>
                        {/* The word says it; no colour carries the hold. */}
                        {member.onHold && (
                          <span className="inline-flex shrink-0 items-center rounded-full border border-border-strong bg-surface-2 px-3 py-0.5 text-[13px] text-text-soft">
                            {text.onHold}
                          </span>
                        )}
                      </div>
                      {member.displayName && (
                        <div className="truncate text-sm text-text-muted" dir="ltr">
                          {member.email}
                        </div>
                      )}
                      <div className="text-sm text-text-muted">{text.joined(new Date(member.joinedAt).toLocaleDateString())}</div>
                    </div>
                    {/* An icon-only button in the bright red: the name is in its label and its tooltip, and a click still asks first. */}
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-11 rounded-lg border-[color-mix(in_oklab,var(--lp-danger-bright)_35%,transparent)] bg-[color-mix(in_oklab,var(--lp-danger-bright)_10%,transparent)] text-danger-bright hover:bg-[color-mix(in_oklab,var(--lp-danger-bright)_20%,transparent)] hover:text-danger-bright dark:border-[color-mix(in_oklab,var(--lp-danger-bright)_35%,transparent)] dark:bg-[color-mix(in_oklab,var(--lp-danger-bright)_10%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--lp-danger-bright)_20%,transparent)] [&_svg:not([class*='size-'])]:size-5"
                      aria-label={text.removeLabel(nameOf(member))}
                      title={text.removeLabel(nameOf(member))}
                      onClick={() => {
                        setRemoving(member)
                        setRemoveOpen(true)
                      }}
                    >
                      <ActionIcon action="delete" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <div className="flex justify-end">
        <DialogClose render={<Button type="button" variant="outline" size="touch" className={cn(quietActionClass, 'px-5')} />}>
          {text.close}
        </DialogClose>
      </div>

      <Question
        open={askingRights}
        onOpenChange={setAskingRights}
        title={text.rightsTitle}
        description={text.rightsBody}
        confirmLabel={text.rightsConfirm}
        confirmDisabled={!rightsTicked}
        onConfirm={async () => {
          // A refusal by the plan opens the prompt and closes this question: nothing was turned on.
          await gate.run(null, async () => {
            await data.setShareEnabled(pieceId, true, true)
            setLoaded((now) => (now === null ? now : { ...now, share: { ...now.share, enabled: true, rightsConfirmedAt: new Date().toISOString() } }))
            void refreshPlan()
          })
        }}
      >
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base font-medium">
          <Checkbox checked={rightsTicked} onCheckedChange={(checked) => setRightsTicked(checked === true)} className="size-5" />
          {text.rightsTick}
        </label>
      </Question>

      <Question
        open={resetting}
        onOpenChange={setResetting}
        title={text.reset}
        description={text.resetQuestion}
        confirmLabel={text.resetConfirm}
        icon="reset"
        onConfirm={async () => {
          const next = await data.resetShareLink(pieceId)
          setLoaded((now) => (now === null ? now : { ...now, share: next }))
          setCopied(false)
        }}
      />

      <Question
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={text.remove}
        description={removing === null ? '' : text.removeQuestion(nameOf(removing))}
        confirmLabel={text.removeConfirm}
        destructive
        onConfirm={async () => {
          if (removing === null) return
          await data.removeMember(pieceId, removing.userId)
          // The member is gone: the list drops them here, with no second read that could fail after the change was made. Their
          // place goes to the oldest person on hold, worked out as the database does (domain/memberLimit).
          setLoaded((now) => {
            if (now === null) return now
            const left = now.members.filter((member) => member.userId !== removing.userId)
            if (now.limit === null) return { ...now, members: left }
            const held = membersOnHold(left, now.limit.limit)
            return {
              ...now,
              members: left.map((member) => ({ ...member, onHold: held.has(member.userId) })),
              limit: { ...now.limit, count: left.length },
            }
          })
        }}
      />
    </>
  )
}

/**
 * The owner's share dialog: the link, on or off, a new link, and who has joined, with the piece's member limit and who is on
 * hold over it. Each change is saved at once.
 */
export function ShareDialog({ pieceId, open, onOpenChange }: { pieceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No built-in close button: it has a fixed English label, so the dialog has a Close button of its own. */}
      <DialogContent showCloseButton={false} className="flex max-h-[90dvh] flex-col gap-5 overflow-y-auto rounded-card p-6 sm:max-w-[560px]">
        <ShareBody pieceId={pieceId} />
      </DialogContent>
    </Dialog>
  )
}
