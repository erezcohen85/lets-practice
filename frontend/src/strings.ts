// The single file for UI text. Components never hold literal UI strings.
import { type BarNames } from './domain/barNames'
import { type StepKind, type StepLabel } from './domain/history'
import { type LimitGroup, type LimitKey, type PlanId, type PlanRow } from './domain/planLimits'
import { TERMS_VERSION } from './domain/terms'

// Erez's answers to spec section 11 (Decisions 2026-11-04).
export const TERMS_CONTACT = 'lets.practice.app@gmail.com'
const TERMS_COUNTRY = 'Israel'

/** The plural name of the note a meter's denominator counts, for the lengths of short bars. */
const noteNames: Record<number, string> = { 1: 'wholes', 2: 'halves', 4: 'quarters', 8: 'eighths', 16: 'sixteenths', 32: 'thirty-seconds' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "1 piece", "3 pieces": a count and its noun. */
const countOf = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
/** How often a limit of `count` lets something happen: once, twice, 5 times. */
const timesOf = (count: number) => (count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`)
/** What "used" reads as when `count` were allowed: it (one), both (two), all 5. */
const usedAll = (count: number) => (count === 1 ? 'it' : count === 2 ? 'both' : `all ${count}`)

export const strings = {
  app: {
    name: "Let's Practice",
    tagline: 'Practice along, bar by bar.',
  },
  // The token showcase page (/tokens.html). Not a product screen: it is for checking the theme by eye.
  showcase: {
    title: "Let's Practice tokens",
    intro: 'Every swatch paints with a --lp-* variable, so what you see follows the active theme.',
    toLight: 'Switch to light theme',
    toDark: 'Switch to dark theme',
    themeNow: { dark: 'Theme: dark (default)', light: 'Theme: light (approved 2026-11-06)' },
    sections: {
      colours: 'Colour roles',
      flags: 'Review Queue flag chips',
      aurora: 'Aurora (brand moments only)',
      paper: 'Paper',
      type: 'Type scale',
      radius: 'Radius',
      buttons: 'Buttons',
    },
    flags: {
      crowded: 'Crowded bar',
      beatCount: 'Beat count',
      weakDownbeat: 'Weak downbeat',
      stretched: 'Stretched bar',
    },
    paperBar: 'Bar 12',
    paperNote: 'Ink on paper, the cursor line glides across the bar.',
    typeSample: 'Practice along, bar by bar',
    buttonDefault: 'Default',
    buttonOutline: 'Outline',
  },
  // The Editor's Undo / Redo buttons; the tooltips name the step (undoTooltip, redoTooltip below).
  history: {
    undo: 'Undo',
    redo: 'Redo',
    nothingToUndo: 'Nothing to undo',
    nothingToRedo: 'Nothing to redo',
  },

  // Shared by every screen (task 4.2): the shell, the state cards, the not found and not configured pages.
  common: {
    backToLibrary: 'Library',
    goToLibrary: 'Go to library',
    loading: 'Loading',
    loadingSession: 'Getting your account ready',
    retry: 'Try again',
    notFoundTitle: 'Page not found',
    notFoundText: 'This page does not exist, or the piece it belonged to was deleted.',
    notConfiguredTitle: 'Not connected yet',
    notConfiguredText:
      'This build has no backend configured. The real backend comes in a later phase. To try the app now, run it on the in-memory demo with VITE_USE_FAKES=1.',
    settings: 'Settings',
    account: 'Your account',
    // The account menu under the avatar in the top bar: Sign out is its only item.
    signOut: 'Sign out',
    signOutFailed: 'We could not sign you out. Please try again.',
    // The Practice / Edit switch at the end of the Practice and Editor top bars.
    viewSwitch: 'Practice or Edit',
    viewPractice: 'Practice',
    viewEdit: 'Edit',
  },

  // Landing page and sign-in (task 4.3). The headline is landing.headline; app.tagline stays for other uses.
  landing: {
    github: 'GitHub',
    githubUrl: 'https://github.com/erezcohen85/lets-practice',
    terms: 'Terms',
    contact: 'Contact us',
    contactUrl: `mailto:${TERMS_CONTACT}`,
    // The hero's white Google button (it signs in or signs up in one step) and the demo button beside it.
    signInOrUp: 'Sign in / Sign up with Google',
    practiceDemo: 'Practice Demo',
    // The headline is two lines; the line break is a real one so the two halves can be read by a screen reader as one heading.
    headline: ['Practice', 'Makes Perfect'],
    subtitle: 'Made for musicians by musicians',
    signInFailed: 'We could not sign you in. Please try again.',
    intro: 'Upload your sheet music and align it to your guide recordings automatically for a high quality practice experience.',
    // The small title above the three feature cards.
    howItWorks: 'How does it work?',
    // The one-minute film in the hero: it loops with the sound on where the browser allows it, else from the first tap.
    film: {
      label: "Let's Practice in one minute, a film of the app",
      description:
        'A one-minute film of the app with music, captioned: Upload your music. Get interactive sheet music. Aligned to your recording. Share with your students and ensemble. They practice with your recording. Each player sees their own part.',
      controls: 'Film controls',
      play: 'Play the film',
      pause: 'Pause the film',
      restart: 'Play the film from the start',
      soundOn: 'Turn sound on',
      soundOff: 'Turn sound off',
      fullScreen: 'Full screen',
      creditNote: 'Excerpted, looped and synced to a screen recording of the app.',
    },
    features: [
      { title: 'Upload', text: 'Upload your recording and sheet music.' },
      { title: 'Align', text: 'The PDF aligns to the music automatically for you to review in the editor.' },
      { title: 'Practice', text: 'Navigate the recording through interactive sheet music. Loop, slow down, find inspiration or just play along.' },
      { title: 'Share', text: 'Share your pieces with your students or ensemble members.' },
    ],
    licence: 'Open source under AGPL-3.0',
  },

  // The public demo at /demo: the Practice screen on fixed files. The way back at the start of its top bar goes to the landing page.
  demo: {
    back: 'Home',
    credits: 'Credits',
  },

  // Terms gate (task 4.3) and the user agreement (9.14, spec 9.2). A change that matters bumps TERMS_VERSION in domain/terms.ts.
  terms: {
    gateTitle: 'One step before you start',
    // {account} is replaced by the signed-in email, in bold.
    gateIntro: 'Signed in as {account}. Read and accept the terms to open your library.',
    title: 'Terms of use',
    visitorIntro: 'Read the terms below. Sign in with Google to accept them and open your library.',
    acceptedIntro: 'You have accepted these terms.',
    boxLabel: 'Terms of use, scrollable text',
    documentTitle: "Let's Practice: terms of use",
    versionLine: `Version ${TERMS_VERSION}`,
    // The short summary at the top of the box. It helps a reader find their way; the numbered sections are the agreement.
    summaryTitle: 'In short',
    summary: [
      'Your files stay yours. We use them only to run the app for you, and never to train AI.',
      'Your library is private. Upload files you are lawfully allowed to use for your own practice.',
      'Share a piece only when its score and its recording are each your own, in the public domain, or used with permission, and credit them.',
      'A rights holder can ask us to remove shared material. We tell you why, and you can answer.',
      'A free demo, provided as it is, run from Israel, with your data processed in the EU. You must be 18 or older.',
    ],
    summaryNote: 'This summary is only a guide. The numbered sections below are the terms.',
    // Each section is a heading and its blocks: a string is a paragraph, a list of strings is a bulleted list.
    sections: [
      {
        heading: '1. Who runs this.',
        blocks: [
          `Let's Practice is an open-source project (AGPL-3.0). This copy of it is run by Erez Cohen as a small, free demo. These terms cover this copy only; anyone who runs their own copy sets their own terms. Contact: ${TERMS_CONTACT}.`,
        ],
      },
      {
        heading: '2. Accepting these terms.',
        blocks: ['To use the app you sign in with Google and accept these terms. You must be 18 or older.'],
      },
      {
        heading: '3. Your content stays yours.',
        blocks: [
          'The PDFs and recordings you upload, the maps you make and your practice settings remain yours. You give us a limited permission to use them only to run the app for you: to store them, convert them, read them with automated tools (including a third-party AI service, Claude by Anthropic, which reads your page images to find the bars), and show them to the people you choose to share them with. We do not use your content for marketing, and we do not use it to train AI models; Anthropic\'s terms do not let it train models on it either.',
          'This permission ends when you delete the content or your account. Deleted files are gone at once; deleted records, such as maps and settings, can remain in our database provider\'s backups for up to 30 days, until those backups are replaced. We claim no rights in your music.',
        ],
      },
      {
        heading: '4. What you may upload.',
        blocks: [
          'Your library is private: nobody else sees a piece until you share it, and we do not check what you upload. Upload only files you are lawfully allowed to use for your own practice, for example:',
          [
            'sheet music and recordings you bought or downloaded under terms that allow your own use;',
            'music you wrote, and recordings you made yourself;',
            'public domain and openly licensed material (section 5).',
          ],
          "Do not upload copies you know were made or passed on illegally. We do not approve what you upload, and we are not responsible for it. You are responsible for your content: if it breaks someone else's rights, the responsibility is yours.",
        ],
      },
      {
        heading: '5. What you may share.',
        blocks: [
          'To turn on a share link, you confirm that the piece is your own music, in the public domain, or used with permission, and we store the time you confirmed it. Nobody checks this statement; it is yours. It covers the score and the recording separately, and each of them must be one of these:',
          [
            'Your own music: you wrote it, or you made the recording. A recording you made of music by someone else also needs that music to be in the public domain or used with permission.',
            'In the public domain: nobody holds rights in it any more, both where you live and where the people you share it with live. In the EU, the UK and Israel, a composition is usually free 70 years after the death of its composer; in the United States, it depends on when it was first published. Material marked CC0 or with the Public Domain Mark counts as public domain.',
            'Used with permission: the rights holder allows you to share it this way, or a licence does, such as a Creative Commons licence on the terms below.',
          ],
          'A score and a recording each have their own rights. A plain scan of an old printed edition adds no new rights, but a modern edition, especially a critical or Urtext edition, can still be protected. A recording is usually protected for 50 to 70 years after its release, however old the music. Sites such as IMSLP mark a file where it is still protected in some countries. Sheet music and recordings you buy are usually licensed for your own use only: keep them private unless the licence says you may share them.',
          'Creative Commons licences. Under these licences, music synced to moving images is an adaptation. A score with a cursor moving in time with the recording may count as one, so these terms treat a shared piece as one:',
          [
            'CC BY and CC BY-SA: you may share the piece, with the credit described below.',
            'CC BY-NC and CC BY-NC-SA: you may share the piece only for use that is not mainly aimed at commercial advantage or payment. Lessons, classes or rehearsals that people pay for may not count as non-commercial. If you are not sure, ask the rights holder.',
            'CC BY-ND and CC BY-NC-ND: you may not share the piece. Version 4.0 of these licences lets you make the synced piece for your own private practice; for older versions, read the licence.',
            'ShareAlike (SA): when you share, your own additions to the material, such as the bar map, are offered under the same licence.',
          ],
          'Credit. When a licence asks for credit, give it where the people you share with will see it: the author or performer, the title, a link to the source, the name of the licence with a link to it, any copyright notice that came with the material, and a note saying how you changed it, such as syncing it to the score. Do not suggest that the author supports you or this app.',
          'Teaching. Using music for teaching does not by itself make sharing it lawful. Some countries allow limited use of works in teaching, usually inside a school; those rules seldom cover sharing whole scores or recordings through an app. If you rely on one, the responsibility is yours.',
        ],
      },
      {
        heading: '6. Sharing and people who join.',
        blocks: [
          "A piece is private until you share it. When you share a piece, anyone who has the link and signs in with Google can join it and practise it; they cannot change it. The owner of a piece sees the name and email of everyone who joined it, and people who join see the owner's name. You can turn the link off, make a new link, or remove people at any time. Turning the link off or making a new one stops new people from joining; people who already joined keep access until you remove them or delete the piece. A piece has a limit on how many people can join it. When it is full, new people cannot join; if the limit goes down, the people who joined last are put on hold until there is room.",
          'If someone shares a piece with you, use it only for your own practice and do not pass on its files, unless their own licence allows it (for example a Creative Commons licence).',
        ],
      },
      {
        heading: '7. Rules.',
        blocks: [
          "Do not upload or share content that is illegal, infringes someone else's rights, or is harmful. Do not try to get around the access controls, collect other people's content, or overload the processing.",
        ],
      },
      {
        heading: '8. Removing content.',
        blocks: [
          'We may hide or remove content, or remove the access of the people it was shared with, when we reasonably believe it breaks these rules or the law. We do not review content routinely, and we use no automated tools to find content that breaks the rules: a person handles every report. When we act on your content, we tell you what we did and why, and how to answer.',
        ],
      },
      {
        heading: '9. Copyright complaints.',
        blocks: [
          `If you hold the rights in something shared through this app, or act for someone who does, write to ${TERMS_CONTACT} with:`,
          [
            'your name and contact details, and the rights holder you act for, if it is not you;',
            'the work you say is infringed;',
            'where the material is: the share link, or enough detail to find the piece;',
            'why you believe it infringes;',
            'a statement that you believe in good faith that the use is not allowed by the rights holder or by law, and that your notice is accurate and you are the rights holder or allowed to act for them;',
            'your full name, as your signature.',
          ],
          'What happens next. We confirm that we received your notice. If it is incomplete, we ask for what is missing. If it is complete and appears valid, we promptly remove the material, or the access of everyone it was shared with, and tell its owner what was removed, on which rule, why, and how to answer, including that they can also go to court. We tell you what we decided. We may send the owner a copy of your notice, with your name and email.',
          `Answering a complaint. If your material was removed and you believe that was a mistake, or that you have the right to share it, write to ${TERMS_CONTACT} with what was removed, why you believe this, a statement that this is true to the best of your knowledge, and your name and contact details. We send your answer to the person who complained. Unless they tell us that they have started legal action, we may restore the material 10 to 14 working days after we received your answer.`,
          'Repeat infringement. We close the accounts of people who repeatedly share material that infringes the rights of others. A complaint counts against an account when the material was removed and not restored after an answer.',
          'False notices. Do not send a notice you know to be false. We may set aside notices from someone who keeps sending unfounded ones.',
          'To report anything else that breaks these terms or the law, write to the same address with the link and the reason.',
        ],
      },
      {
        heading: '10. Upload access.',
        blocks: [
          'Anyone who signs in can try the app on the Trial plan. A plan has limits: how many pieces you can make and keep, how long a PDF or a recording can be, which features you can use, such as Advanced Reading and splitting a PDF with several parts, how many pieces you can share, and how often a part can be read again. Other plans, such as Creator and Unlimited, have bigger limits or none.',
          'We give a plan to an email address, and we can change a plan, or the limits of a plan, at any time. We can also pause new pieces for a plan, for a day or for longer, so that the servers keep up. When a limit stops something you try, the app tells you which limit it was. Deleting a piece does not give back a piece you made on the Trial plan.',
          'If your plan changes, the pieces and shares you already have stay. Only new actions follow the new limits.',
        ],
      },
      {
        heading: '11. Suspending an account.',
        blocks: [
          'We may suspend or close an account for serious or repeated breaches of these terms, for repeated infringement (section 9), for conduct that harms others, or when the law requires it. Where reasonable, we tell you first and say why.',
        ],
      },
      {
        heading: '12. Our content.',
        blocks: [
          "The app's source code is open source under AGPL-3.0. That licence covers the code, not your files or maps. Music we show on our own pages, such as the demo piece and the film on the landing page, is in the public domain or used under its licence, and is credited where it appears.",
        ],
      },
      {
        heading: '13. Your data.',
        blocks: [
          `We store your Google name, email address and profile picture, your files and maps, and your practice settings. They are processed by Supabase (database and file storage, in the EU), Railway (processing, in the EU) and the Anthropic API (reading the score). There are no ads, and your data is never sold. You can delete your account and all your content yourself in Settings, under Account. For anything else about your data, write to ${TERMS_CONTACT}.`,
          'Deleting your account. When you delete your account, we keep one thing: a one-way hash of your email address, which cannot be turned back into the address, and the number of Trial pieces you made. We keep it so that a new account with the same email does not start a new trial.',
        ],
      },
      {
        heading: '14. A demo service, as is.',
        blocks: [
          'The app is provided as it is, without any warranty. It may change or stop, and data may be lost, so keep your own copies of your files. As far as the law allows, we are not liable for any loss caused by using it.',
          'Nothing in these terms limits a liability that the law does not allow to be limited, such as for harm caused on purpose or by gross negligence, or takes away rights you have as a consumer under the law that protects you.',
          'If someone makes a claim against us because content you uploaded or shared breaks their rights or these terms, you are responsible for that claim, as far as the law allows.',
          `These terms are governed by the law of ${TERMS_COUNTRY}, and the courts of ${TERMS_COUNTRY} decide disputes about them, unless the law that protects you as a consumer lets you go to court where you live.`,
        ],
      },
      {
        heading: '15. Changes.',
        blocks: [
          'These terms have a version number. If we change them in a way that matters, the app asks you to accept the new version before you continue. Each version applies to what happened while it was in force.',
        ],
      },
    ],
    acceptBefore: 'I have read and accept the ',
    acceptLink: 'terms of use',
    acceptAfter: '.',
    accept: 'Accept and continue',
    signOut: 'Sign out',
    // A visitor's two buttons, side by side: the landing page's white Google button (sign in or sign up in one step) and a way back.
    signInOrUp: 'Sign in / Sign up with Google',
    back: 'Back',
    acceptFailed: 'We could not save your answer. Please try again.',
    signOutFailed: 'We could not sign you out. Please try again.',
    signInFailed: 'We could not sign you in. Please try again.',
  },

  // New piece for someone without upload access (Login and Sharing Spec 5.4).
  limited: {
    title: 'New piece',
    text: 'Uploading pieces is limited for now. You can practise pieces that are shared with you.',
  },

  // Plans and limits (Erez, 2026-11-08; the prototype's "Prompt copy" sticky and boards). The prompt and the Your plan dialog.
  plans: {
    // The prompt: the title, and one sentence for every limit that can refuse something (members_per_piece and members_per_part
    // have their own message on the join page). `plan` is the user's own row, so a sentence says the plan's name and numbers.
    promptTitle: (limit: LimitKey, plan: string) =>
      limit === 'new_pieces_paused' || limit === 'new_pieces_per_day' ? 'New pieces are paused' : `Not in your ${plan} plan`,
    ok: 'OK',
    // Said when the plan could not be read (or the limit is one without a sentence): no name, no number.
    promptGeneric: 'This is not in your plan.',
    prompt: {
      pieces_created_max: (plan: PlanRow) => {
        const count = plan.pieces_created_max ?? 0
        return count === 0
          ? `${plan.name} does not include making pieces.`
          : `${plan.name} includes ${countOf(count, 'piece', 'pieces')}, and you have made ${usedAll(count)}. Deleting a piece does not give one back.`
      },
      pieces_stored_max: (plan: PlanRow) => `${plan.name} keeps up to ${countOf(plan.pieces_stored_max ?? 0, 'piece', 'pieces')} at once. Delete one to make room.`,
      parts_per_piece_max: (plan: PlanRow) =>
        plan.parts_per_piece_max === 1
          ? `${plan.name} pieces have one part. To practice another part, make it a new piece.`
          : `${plan.name} pieces have up to ${countOf(plan.parts_per_piece_max ?? 0, 'part', 'parts')}.`,
      pages_per_part_max: (plan: PlanRow) => `${plan.name} reads PDFs of up to ${plan.pages_per_part_max ?? 0} pages. Choose a shorter PDF.`,
      recording_minutes_max: (plan: PlanRow) =>
        `${plan.name} takes recordings of up to ${countOf(plan.recording_minutes_max ?? 0, 'minute', 'minutes')}. Choose a shorter recording.`,
      advanced_reading: (plan: PlanRow) => `Advanced Reading is not included in ${plan.name}. The part is read the standard way.`,
      advanced_reading_parts_per_month: (plan: PlanRow) =>
        `You have used this month's ${countOf(plan.advanced_reading_parts_per_month ?? 0, 'Advanced Reading part', 'Advanced Reading parts')}.`,
      split_pdf: (plan: PlanRow) =>
        plan.parts_per_piece_max === 1
          ? `${plan.name} pieces have one part, so one PDF with several parts is not included. Choose a PDF that holds one part.`
          : `Splitting a PDF with several parts is not included in ${plan.name}.`,
      suggest_name: () => 'Suggest a name is not in your plan.',
      shared_pieces_max: (plan: PlanRow) =>
        `${plan.name} includes ${countOf(plan.shared_pieces_max ?? 0, 'shared piece', 'shared pieces')}. Turn sharing off on another piece to share this one.`,
      members_per_piece: () => 'This piece has as many members as your plan allows.',
      members_per_part: () => 'This piece has as many members as your plan allows.',
      read_again_per_part_max: (plan: PlanRow) => {
        const count = plan.read_again_per_part_max ?? 0
        return count === 0
          ? `${plan.name} does not include reprocessing a part.`
          : `${plan.name} lets you reprocess each part ${timesOf(count)}, and this part has used ${usedAll(count)}.`
      },
      realign_per_piece_max: (plan: PlanRow) => {
        const count = plan.realign_per_piece_max ?? 0
        return count === 0
          ? `${plan.name} does not include realigning a piece.`
          : `${plan.name} lets you realign each piece ${timesOf(count)}, and this piece has used ${usedAll(count)}.`
      },
      new_pieces_per_day: (plan: PlanRow) => `${plan.name} has used today's new pieces. Try again tomorrow.`,
      new_pieces_paused: (plan: PlanRow) => `New pieces are paused for ${plan.name} for now. Try again later.`,
    } satisfies Record<LimitKey, (plan: PlanRow) => string>,
    // For a job the processor ended with a plan refusal, where a sentence of `prompt` would say something untrue because the job did not run.
    jobPrompt: {
      advanced_reading: (plan: PlanRow) => `Advanced Reading is not included in ${plan.name}, so this part was not read. Turn it off and try again.`,
    } satisfies Partial<Record<LimitKey, (plan: PlanRow) => string>>,
    // The Library: how much of the plan is used, and the line under it.
    usedLine: (used: number, max: number, plan: string) => `${used} of ${max} ${plan.toLowerCase()} pieces used.`,
    upgrade: 'Upgrade your plan for more.',
    // New piece and Add part: what the plan takes, under the recording and in the PDF drop zone (the boards' "Up to 10 minutes on Trial.").
    recordingHint: (plan: string, minutes: number) => `Up to ${countOf(minutes, 'minute', 'minutes')} on ${plan}.`,
    pdfHint: (plan: string, pages: number) => `PDF only. Up to ${countOf(pages, 'page', 'pages')} on ${plan}, and 50 MB.`,
    // The question before a delete: a piece made does not come back.
    deleteNote: (plan: string, used: number, max: number) => `${plan} pieces don't come back when you delete one: you stay at ${used} of ${max}.`,
    // Read a part again: what is left, in the question before it starts and in the part's menu.
    readAgainLeft: (plan: string, left: number, max: number) =>
      left <= 0 ? `${plan}: no reprocesses left for this part.` : `${plan}: ${left} of ${max} reprocesses left for this part.`,
    readAgainConfirm: (plan: string, left: number) =>
      left === 1 ? `${plan}: this is the last reprocess for this part.` : `${plan}: ${left} reprocesses left for this part.`,
    // The label before the Settings gear, and what a screen reader hears.
    badge: { trial: 'TRIAL', creator: 'CREATOR', unlimited: 'UNLIMITED', admin: 'ADMIN' } satisfies Record<PlanId | 'admin', string>,
    badgeScreenReader: (plan: string) => `Your plan: ${plan}`,
    // The account menu.
    menuItem: 'Plan',
    // The Your plan dialog.
    yourPlan: {
      title: (plan: string) => `Your plan: ${plan}`,
      adminName: 'Admin',
      noLimits: 'No limits',
      noLimit: 'No limit',
      ok: 'OK',
      rows: {
        pieces: 'Pieces',
        parts: 'Parts',
        sharedPieces: 'Shared pieces',
        advancedReading: 'Advanced Reading',
        splitPdf: 'Split a multi-part PDF',
        readAgain: 'Read a part again',
        recording: 'Recording',
        pdf: 'PDF',
      },
      values: {
        made: (made: number, max: number) => `${made} of ${max} made`,
        partsPerPiece: (max: number) => `${countOf(max, 'part', 'parts')} per piece`,
        sharedOf: (shared: number, max: number) => `${shared} of ${max}`,
        included: 'Included',
        notIncluded: 'Not included',
        advancedMonthly: (used: number, max: number) => `${used} of ${max} parts this month`,
        perPart: (max: number) => `${max} per part`,
        upToMinutes: (max: number) => `Up to ${countOf(max, 'minute', 'minutes')}`,
        upToPages: (max: number) => `Up to ${countOf(max, 'page', 'pages')}`,
      },
    },
  },

  // Library (task 4.4).
  library: {
    title: 'Library',
    pieceCount: (count: number) => (count === 1 ? '1 piece' : `${count} pieces`),
    newPiece: 'New piece',
    // The word beside the title of a copy of the sample piece; a word, so no colour has to carry it.
    sampleLabel: 'Sample',
    searchLabel: 'Search pieces',
    searchPlaceholder: 'Search pieces',
    filterLabel: 'Show pieces',
    filterAll: 'All',
    filterNeedsReview: 'Needs review',
    filterReady: 'Ready to practice',
    filterShared: 'Shared with me',
    // The dashed box under the "Shared with me" filter when nothing has been shared yet.
    sharedEmptyText: 'Nothing has been shared with you yet. When someone sends you a link, the piece shows up here.',
    viewLabel: 'View',
    viewCards: 'Card view',
    viewList: 'List view',
    moreFor: (title: string) => `More for ${title}`,
    menuRename: 'Rename',
    menuShare: 'Share',
    menuDelete: 'Delete',
    menuLeave: 'Leave',
    // "3 parts, 4:31"; the duration is left out until the audio has been read.
    cardSubtitle: (parts: number, duration: string) => {
      const partsText = parts === 1 ? '1 part' : `${parts} parts`
      return duration === '' ? partsText : `${partsText}, ${duration}`
    },
    status: {
      processing: (percent: number) => `Processing ${percent}%`,
      failed: 'Processing failed',
      needsReview: (checked: number, total: number) => `Needs review: ${checked} of ${total} checked`,
      ready: 'Ready to practice',
    },
    progressLabel: 'Processing progress',
    loading: 'Loading your pieces',
    emptyTitle: 'No pieces yet',
    emptyText: 'Add a recording and the PDF parts, and your first piece will be ready in a few minutes.',
    errorTitle: "Couldn't load your library",
    errorText: 'Your pieces did not load. Check your connection and try again.',
    noMatchTitle: 'No pieces match',
    noMatchText: 'Try a different search, or show all your pieces.',
    showAll: 'Show all pieces',
    myPieces: 'My pieces',
    sharedWithMe: 'Shared with me',
    sharedBy: (name: string) => `Shared by ${name}`,
    beingPrepared: 'Being prepared',
    // A shared piece the user is on hold for (migration 0014): its card cannot be opened.
    onHold: 'On hold: this piece is full. You get access again when its owner makes room.',
    ownerFilterLabel: 'Filter by who shared it',
    ownerAll: 'All',
  },

  // New piece (task 4.5).
  newPiece: {
    title: 'New piece',
    titleLabel: 'Title',
    recordingLabel: 'Recording',
    audioChoose: 'Choose an audio file',
    audioDropZone: 'Drop the audio file here, or click to choose it',
    partsLabel: 'Parts',
    partsHint: 'Names are read from each PDF. Change any you like, or leave them.',
    dropZone: 'Choose PDFs, or drop several at once',
    // The true limits: the processor's 100 pages for one part PDF and the 50 MB the storage and the browser check allow.
    dropZoneLimits: 'PDF only. Up to 100 pages and 50 MB per file.',
    partName: 'Part name',
    // Shown in a part's name field while it is empty: the processing then names the part after its header (else its file).
    partNameHint: 'Leave empty to use the name on the part',
    readingName: 'Reading the part name…',
    removePart: 'Remove part',
    // Takes the names of the files that were turned away, already joined: "notes.txt, cover.png".
    notPdf: (names: string) => `Skipped, not a PDF: ${names}`,
    start: 'Start processing',
    starting: 'Starting…',
    startNote: 'Takes a few minutes per piece. You can leave while it runs.',
    startFailed: 'Processing could not be started. Your entries are still here, so you can try again.',
    errors: {
      titleMissing: 'Give the piece a title.',
      recordingMissingFile: 'Choose an audio file.',
      partsMissing: 'Add at least one PDF.',
      partNotPdf: 'This file is not a PDF.',
    },
  },

  // Processing (task 4.6).
  processing: {
    title: (pieceTitle: string) => `Preparing ${pieceTitle}`,
    leaveNote: 'You can leave this page: the piece keeps processing in your library.',
    // The ring's accessible name; the percentage is a whole number, 0 to 100.
    progressLabel: (percent: number) => `Progress ${percent}%`,
    loading: 'Getting your piece',
    stepsLabel: 'Steps',
    steps: {
      recording: 'Uploading your music',
      pdf: 'Reading your sheet music',
      bars: 'Locating bars and musical marks',
      matching: 'Aligning the bars to the recording',
      problems: 'Reviewing for problems',
    },
    // Each step says its state in words as well as in colour: Done and In progress are read out, Waiting and Failed shown.
    stepStates: { done: 'Done', active: 'In progress', waiting: 'Waiting', failed: 'Failed' },
    // What the PDF step found, as "3 parts, 12 pages".
    partsAndPages: (parts: number, pages: number) =>
      `${parts} ${parts === 1 ? 'part' : 'parts'}, ${pages} ${pages === 1 ? 'page' : 'pages'}`,
    // Under the step that takes the longest, while it runs, so a job at the same percentage for minutes does not look stuck.
    longestStep: 'This is the longest step. It can take a few minutes.',
    backToLibrary: 'Back to library',
    failedTitle: 'Processing failed',
    failedFallback: 'Something went wrong while processing this piece.',
    // A job that has shown no change for ten minutes: it may be reading a long part, or it may have been lost. Try again
    // starts it anew only if the processor has lost it; a live job answers "still being prepared".
    stalled: 'This is taking longer than usual. You can keep waiting, or try again.',
    starting: 'Starting…',
    retryFailed: 'Processing could not be started. Try again in a moment.',
    loadFailedTitle: 'Could not load this piece',
    loadFailedText: 'Check your connection, then try again.',
  },

  // Piece hub (task 4.7).
  hub: {
    rename: 'Rename',
    delete: 'Delete',
    cancel: 'Cancel',
    // "3 parts, recording 4:31"; the length is left out until the audio has been read.
    summary: (parts: number, duration: string) => {
      const partsText = parts === 1 ? '1 part' : `${parts} parts`
      return duration === '' ? partsText : `${partsText}, recording ${duration}`
    },
    practice: 'Practice',
    practicePart: (name: string) => `Practice ${name}`,
    edit: 'Edit',
    editPart: (name: string) => `Edit ${name}`,
    reviewTitle: (checked: number, total: number) => `Needs review: ${checked} of ${total} checked`,
    reviewText: 'You can practice now. Checking the rest makes the cursor more exact.',
    // A finished job left out the parts it could not read; the others were read and are here.
    skippedTitle: (count: number) => (count === 1 ? 'One part could not be read' : `${count} parts could not be read`),
    skippedPart: (name: string, reason: string) => (reason === '' ? name : `${name}: ${reason}`),
    skippedText: (count: number) =>
      count === 1 ? 'Its PDF is kept with the piece. Try again reads it once more.' : 'Their PDFs are kept with the piece. Try again reads them once more.',
    skippedRetryFailed: 'It could not be started. Try again in a moment.',
    // The last Realign or Add part ended in an error. The piece keeps the map it had; the owner can still practise and edit.
    jobFailedTitle: (kind: 'realign' | 'add-parts') => (kind === 'realign' ? 'The last Realign did not finish' : 'The last Add part did not finish'),
    jobFailedText: 'Something went wrong. You can still practise and edit this piece.',
    editMap: 'Edit map',
    recording: 'Recording',
    playRecording: 'Play the recording',
    pauseRecording: 'Pause the recording',
    moreFor: (name: string) => `More for ${name}`,
    recordingPosition: 'Recording position',
    waveformLoading: 'Loading the waveform',
    waveformMissing: 'The waveform shows once the piece has been processed.',
    waveformError: 'The waveform did not load.',
    parts: 'Parts',
    addPart: 'Add part',
    addPartsTitle: 'Add parts',
    addPartsText: 'Choose one PDF for each part. Names are read from each PDF. Change any you like, or leave them.',
    addPartsSubmit: 'Add parts',
    addPartsSubmitting: 'Adding…',
    addPartsNote: 'The bars are found in each new part. The rest of the piece stays as it is.',
    addPartsFailed: 'The parts could not be added. Your entries are still here, so you can try again.',
    partStatus: {
      reviewed: (checked: number, total: number) => `Reviewed ${checked} of ${total}`,
      notReviewed: 'Not reviewed yet',
      allChecked: 'Reviewed, all checked',
    },
    shareButton: 'Share',
    sharedBy: (name: string) => `Shared by ${name}`,
    joinedNote: 'Added to your library',
    leave: 'Leave',
    leaveQuestion: (title: string) => `Leave ${title}? It disappears from your library. You can join again with the link.`,
    leaveConfirm: 'Leave',
    leaveCancel: 'Cancel',
    leaveFailed: 'We could not do that. Please try again.',
    beingPreparedTitle: 'Being prepared',
    beingPreparedText: 'This piece is not ready to practise yet. Come back in a little while.',
    loading: 'Loading this piece',
    loadErrorTitle: "Couldn't load this piece",
    loadErrorText: 'The piece did not load. Check your connection and try again.',
    failedTitle: 'Processing failed',
    failedText: 'Something went wrong while preparing this piece.',
    // A piece that was saved and never started (the page was left, or the server could not be reached).
    notStartedText: 'This piece was saved but its reading never started. Try again to start it.',
    retryFailed: 'Processing could not be started again. Try once more in a moment.',
    renameTitle: 'Rename piece',
    renameLabel: 'Title',
    renameSave: 'Save',
    renameEmpty: 'Give the piece a title.',
    renameTooLong: 'A title can have up to 200 characters.',
    renameFailed: 'The new title could not be saved. Try again.',
    // Renaming a part (its row on the hub; the editor's part menu says "Rename this part").
    renamePart: (name: string) => `Rename ${name}`,
    renamePartTexts: {
      title: 'Rename part',
      label: 'Part name',
      save: 'Save',
      empty: 'Give the part a name.',
      tooLong: 'A part name can have up to 80 characters.',
      failed: 'The new name could not be saved. Try again.',
    },
    // Renaming the recording (the pencil on the Recording card).
    renameRecording: 'Rename recording',
    renameRecordingTexts: {
      title: 'Rename recording',
      label: 'Recording name',
      save: 'Save',
      empty: 'Give the recording a name.',
      tooLong: 'A recording name can have up to 120 characters.',
      failed: 'The new name could not be saved. Try again.',
    },
    deleteTitle: (title: string) => `Delete ${title}?`,
    deleteText: 'This removes its recording, parts and map.',
    deleteFailed: 'The piece could not be deleted. Try again.',
  },

  // Delete part (UX plan part 3, Decisions 2026-11-01): the part's files are deleted for good.
  partDelete: {
    delete: (name: string) => `Delete ${name}`,
    title: (name: string) => `Delete ${name}?`,
    text: "This deletes the part's PDF, its pages and its bar boxes for good. The recording and the other parts stay.",
    lastTitle: (name: string) => `${name} is the last part`,
    lastText: 'A piece needs at least one part. To remove everything, delete the piece instead.',
    close: 'Close',
    failed: 'The part could not be deleted. Try again.',
  },
  // Reprocess part on the hub: a part that came out wrong is read again from its PDF.
  partReprocess: {
    reprocess: (name: string) => `Reprocess ${name}`,
    title: (name: string) => `Reprocess ${name}?`,
    text: 'This part is read again from its PDF. Its boxes and edits are replaced. The other parts and the recording stay.',
    submit: 'Reprocess',
    failed: 'The part could not be reprocessed. Try again.',
  },

  // Suggest a name (UX plan part 3): one AI call that proposes the piece title; the user saves or edits it.
  suggestName: {
    button: 'Suggest a name',
    busy: 'Asking…',
    failed: 'No name could be suggested. Try again.',
  },

  // The score of the editor (task 5.3).
  score: {
    region: 'Score',
    pageAlt: (page: number, total: number) => `Page ${page} of ${total}`,
    // "Page 2 of 4 · bars 33–48" (middle dot, en dash); "bar 5" when the page holds one bar, no bars part when none.
    // The bars are labels ("7", "p7").
    pageLabel: (page: number, total: number, firstBar: string | null, lastBar: string | null) => {
      const pageText = `Page ${page} of ${total}`
      if (firstBar === null || lastBar === null) return pageText
      return firstBar === lastBar ? `${pageText} · bar ${firstBar}` : `${pageText} · bars ${firstBar}–${lastBar}`
    },
    unmatched: 'Not matched to the recording yet',
    moved: 'Bar line moved by hand',
    movedTag: (bar: string, offset: string) => `Bar ${bar} moved ${offset} s`,
    // Visible next to the buttons; their names say what is zoomed.
    zoomLabel: 'Zoom',
    zoomIn: 'Zoom score in',
    zoomOut: 'Zoom score out',
    zoomPercent: (percent: number) => `${percent}%`,
  },

  // Playing the recording (task 6.2).
  player: {
    play: 'Play',
    pause: 'Pause',
    loading: 'Loading the recording',
    loadFailed: 'The recording could not be loaded. Reload the page and try again.',
    speedLabel: 'Playback speed',
    // Rounded to two places: the speed slider gives 0.85 and 1.05 as well as the whole steps.
    speed: (rate: number) => `${Math.round(rate * 100) / 100}×`,
  },

  // The waveform dock at the bottom of the Editor (task 6.4).
  dock: {
    region: 'Waveform',
    play: 'Play',
    pause: 'Pause',
    noRecording: 'This piece has no recording to play here yet.',
    noWaveform: 'The waveform is not ready for this piece yet.',
    loadFailed: 'The waveform could not be loaded. Reload the page and try again.',
    barChip: (bar: string) => `Bar ${bar}`,
    barChipLabel: 'Bar under the playhead',
    timeTotal: (total: string) => `/ ${total}`,
    timeLabel: 'Playback time',
    locators: 'Locators',
    filterAll: (count: number) => `All ${count}`,
    filterReview: (count: number) => `Review queue ${count}`,
    beatLines: 'Beat lines',
    // Snap to a detected beat (UX part 4).
    snapPrevious: 'Snap to previous beat',
    snapClosest: 'Snap to closest beat',
    snapNext: 'Snap to next beat',
    snapGroup: 'Snap the selected bar line to a beat',
    snapNoBeats: 'This recording has no detected beats to snap to.',
    // The hover text of an off Snap button says why it is off.
    snapPickLine: 'Select a bar line first: click it on the waveform, or its bar on the score.',
    snapNoBeatWay: {
      previous: 'No beat before this bar line, or it would cross its neighbour.',
      next: 'No beat after this bar line, or it would cross its neighbour.',
      closest: 'No beat within 0.15 s of this bar line, or it is on its beat already.',
    },
    rangePreview: 'Bar lines in this range are selected',
    snapDone: (moved: number, skipped: number) =>
      `${moved} ${moved === 1 ? 'bar line' : 'bar lines'} snapped to a beat.` +
      (skipped === 0 ? '' : ` ${skipped} stayed where ${skipped === 1 ? 'it was' : 'they were'}: no beat that way, or it would cross a neighbour.`),
    snapNone: 'None of the selected bar lines can snap that way: no beat there, or it would cross a neighbour.',
    snapDoneClosest: (moved: number, skipped: number) =>
      `${moved} ${moved === 1 ? 'bar line' : 'bar lines'} snapped to the closest beat.` +
      (skipped === 0 ? '' : ` ${skipped} stayed where ${skipped === 1 ? 'it was' : 'they were'}: no beat close by, or it would cross a neighbour.`),
    snapNoneClosest: 'None of the selected bar lines moved: each is on a beat, has no beat close by, or would cross a neighbour.',
    // Bar lines on the beats: the group after Snap. Half-time and Double-time change how many beats a bar has; Continue goes on
    // from the bars the player checked by ear. The segments 1 to 6 are the beats a bar.
    grid: {
      group: 'Bar lines on the beats',
      beatsABarWord: 'Beats a bar',
      // Below 1700 px Half-time, Double-time and the 1 to 6 fold into this one button, which opens a menu of the same choices.
      beatsMenu: 'Beats',
      beatsMenuHint: 'Half-time, Double-time, or the number of beats a bar.',
      continue: 'Continue',
      halfTime: 'Half-time',
      doubleTime: 'Double-time',
      beatsABar: (beats: number) => `${beats} ${beats === 1 ? 'beat' : 'beats'} a bar`,
      // The hover text of a control that works, and (below it) why one that does not is off.
      continueOn: (first: string, last: string) => `Continue from your bars ${first} to ${last}: put the bar lines after them on the beats.`,
      halfTimeOn: (to: number, from: number) => `Half-time: ${to} ${to === 1 ? 'beat' : 'beats'} a bar instead of ${from}.`,
      doubleTimeOn: (to: number, from: number) => `Double-time: ${to} ${to === 1 ? 'beat' : 'beats'} a bar instead of ${from}.`,
      beatsOn: (beats: number) => (beats === 1 ? 'Put a bar line on every beat.' : `Put a bar line on every ${beats} beats.`),
      noBeats: 'This recording has no detected beats.',
      noLines: 'There are no bar lines to put on the beats yet.',
      selectionNoLine: 'The selected bar has no bar line yet. Select a bar line, or clear the selection to use the whole piece.',
      noRoom: 'There is no recording left after this bar line.',
      cannotMeasure: 'Cannot tell how many beats a bar has here. Select two or more bar lines, or pick a number of beats.',
      halfTimeTooMany: (now: number) => `Already ${now} ${now === 1 ? 'beat' : 'beats'} a bar: Half-time would make it ${now * 2}, and the most is 6.`,
      doubleTimeTooFew: 'Already 1 beat a bar: Double-time would be less than 1.',
      doubleTimeNotWhole: (now: number) => `Already ${now} beats a bar: Double-time would not make a whole number of beats.`,
      nothingToLearn: 'Check 3 bars in a row by ear first: Sounds right on 4 bar lines.',
      // Four lines are checked, but there is no pulse in them to go on with.
      notSteady: 'Your last 3 checked bars do not hold the same number of beats, or a bar line is not on a beat.',
      continueElsewhere: 'Continue starts after the last of 4 or more checked bar lines in a row. Select that bar line, or select nothing.',
      nothingChanges: 'Nothing would change: the bar lines are on those beats already.',
      // Nothing was selected, so the whole piece would change.
      wholeTitle: 'Change the whole piece?',
      wholeText: 'Nothing is selected, so this puts bar lines on the beats from the first bar to the end. You can undo it.',
      wholeConfirm: 'Change the whole piece',
      wholeCancel: 'Cancel',
      wholeFailed: 'The bar lines could not be changed. Try again.',
      // What it did, said in the hint line for a few seconds. The undo step reads "put bar lines on the beats".
      continued: (first: string, last: string) => `Continued from your bars ${first} to ${last}: `,
      // spread: the placed lines the beats did not give, set evenly before the next checked bar line so the bars between keep their count.
      done: (placed: number, removed: number, dropped: number, spread = 0) =>
        (placed === 0 ? 'No bar lines placed on the beats.' : `${placed} ${placed === 1 ? 'bar line' : 'bar lines'} placed on the beats.`) +
        (removed === 0 ? '' : ` ${removed} removed.`) +
        (dropped === 0 ? '' : ` ${dropped} later ${dropped === 1 ? 'bar line' : 'bar lines'} dropped past the last bar.`) +
        (spread === 0 ? '' : ` ${spread} spread evenly before the next checked bar line.`),
      // The "Ask me" panel over the waveform, after 3 bars in a row were checked by ear (Settings > Editing > Continue from my bars).
      prompt: (first: string, last: string, beats: number, end: string) =>
        `Your bars ${first} to ${last} hold ${beats} ${beats === 1 ? 'beat' : 'beats'} each. Continue that pattern to bar ${end}?`,
      // The panel's name for screen readers: the Settings label of the same choice.
      promptRegion: 'Continue from my bars',
      promptContinue: 'Continue',
      promptNotNow: 'Not now',
      refusedNothing: 'The bar lines could not be put on the beats here: none would change, or a checked bar line is in the way.',
      refusedNoRoom: 'That would push a checked bar line off the last bar, so nothing changed.',
      // The Wrong beat card's button when no card is waiting any more (it was settled between the card being drawn and the press).
      noWrongBeat: 'No Wrong beat card is waiting any more, so nothing changed.',
    },
    zoom: 'Zoom waveform',
    zoomIn: 'Zoom in on the waveform',
    zoomOut: 'Zoom out on the waveform',
    graph: 'Recording waveform with the bar lines. Click to move the play line. Arrow keys select the next or previous bar line.',
    // The button of the Locators line: on, a click on the waveform adds a locator instead of moving the play line (L toggles, Esc turns it off).
    addLocator: 'Add locator',
    was: 'was',
    // Locator edits (task 6.5). The tag takes the label ("12" or "12 (2)") and the signed offset ("+0.42").
    movedTag: (label: string, offset: string) => `Bar ${label} · moved ${offset} s`,
    filledTag: (label: string) => `Bar ${label} · filled in`,
    filledRunTag: (first: string, last: string) => `Bars ${first} to ${last} · filled in`,
    movedChip: (count: number) => `${count} moved`,
    movedChipLabel: 'Bar lines moved by hand',
    dragPreview: 'New place of the bar line',
    relabelField: 'Bar number of this locator',
    relabelInvalid: 'Type a bar number, like 12, p7 for a pickup bar, or 12 (2) for its second time.',
    relabelUnknown: 'That bar is not in the play order.',
  },

  // The Edit sheet and its messages (task 5.4).
  editor: {
    sheet: 'Edit bar lines',
    // The draggable lines between the editor's regions (spec: sizes last for the visit only).
    resizeQueue: 'Resize the Review Queue',
    resizeDock: 'Resize the waveform',
    // The accessible names of the three tools; the buttons show the short names.
    modes: { move: 'Move bar lines', add: 'Add a bar line', delete: 'Delete a bar line' },
    modeLabels: { move: 'Move', add: 'Add', delete: 'Delete' },
    modeKeys: { move: 'V', add: 'B', delete: 'X' },
    renumber: 'Renumber the bars after',
    // What the switch shows when the sheet is narrow; its accessible name stays the full text.
    renumberShort: 'Renumber',
    renumberTip:
      'Decides how the recording times move when Structure adds or removes a bar. On: the times after it move with their bars. Off: they stay on the bar numbers.',
    // The line under the sheet; a refused edit replaces it for a moment.
    hints: {
      add: 'Click inside a bar to split it. Click a bar line to remove it.',
      delete: 'Click a bar line to remove it.',
    },
    addHere: 'Add bar line here',
    moveHandle: 'Drag to move this bar line',
    refusals: {
      'no-box': 'There is no bar there to edit.',
      'too-narrow': 'That would leave a bar too narrow. Choose a spot farther from the bar lines.',
      'line-end': 'This bar line ends a line of music, so it cannot be removed or moved past its neighbour.',
      'not-line-start': 'Only the first bar of a line of music has a start that can be moved.',
      'not-line-end': 'Only the last bar of a line of music has an end that can be moved.',
      'only-bar': 'This part has only one bar, so it has no bar line to edit.',
      invalid: 'That edit is not possible.',
      'in-multi-rest': 'This box holds several bars. Change how many bars it holds instead (Bars in this box).',
      'no-piece-pickup': 'The piece has no pickup bar. Add it on the Piece tab.',
      'part-has-pickup': 'This part has its pickup bar (p1).',
      'pickup-edge': 'A pickup bar cannot be the first bar (add it at the top of the piece instead) or the last bar.',
      'already-pickup': 'That bar is a pickup bar already.',
      'next-to-pickup': 'A pickup bar cannot sit next to another one.',
      'already-in-order': 'Every locator already sits on its bar of the play order.',
    },
    // The switch for the selected bar on the Edit bar lines panel.
    pickupBar: {
      label: 'Pickup bar',
      short: 'Pickup bar',
      tip: 'Makes the selected bar a pickup: a short bar with no number of its own, shown as p and the next bar number. Needs Edit piece on. Set its length in Structure, Bars.',
    },
    // "Edit piece structure" and "Bars in this box" (Decisions 2026-11-03).
    pieceEditing: {
      switch: 'Edit piece structure',
      // What the toolbar shows; the switch's accessible name is the full text above.
      switchShort: 'Edit piece',
      warningTitle: 'Edit the structure of the whole piece?',
      warningText: (part: string) =>
        `While this is on, adding or deleting a bar line, or changing how many bars a box holds, changes the piece for every part, not only ${part}. Every change to the number of bars asks first.`,
      turnOn: 'Turn on',
      turnOff: 'Turn off',
      idleAsk: 'Still editing the piece?',
      keep: 'Keep editing',
      idleOff: 'Piece editing was turned off after a while without use.',
      hintAdd: (part: string) => `Click inside a bar to add a bar to the piece and to ${part}. Click a bar line to remove it from both.`,
      hintDelete: (part: string) => `Click a bar line to remove a bar from the piece and from ${part}.`,
      barsInBox: 'Bars in box',
      barsInBoxTip: 'How many bars this box holds. More than 1 makes it a multi-rest.',
      fewer: 'One bar fewer in this box',
      more: 'One bar more in this box',
      confirmTitle: 'This changes the whole piece',
      confirmBars: (added: number, removed: number, parts: number) =>
        added > 0
          ? `${added === 1 ? '1 bar is' : `${added} bars are`} added to the piece, for all ${parts} parts.`
          : `${removed === 1 ? '1 bar is' : `${removed} bars are`} removed from the piece, for all ${parts} parts.`,
      confirmOff: (names: string[], more: number) =>
        names.length === 0
          ? 'Every part will then have the same number of bars as the piece.'
          : `Then ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''} will have another number of bars than the piece, until each is fixed.`,
      confirmTimes: (count: number) => `${count === 1 ? '1 recording time is' : `${count} recording times are`} cleared; Realign refits them.`,
      confirmAction: 'Change the piece',
    },
    notSaved: 'Not saved',
    retrySave: 'Retry',
    // The top bar of the Editor page (task 5.6).
    pieceHub: 'Piece hub',
    partMenu: 'Parts',
    renamePart: 'Rename this part',
    deletePart: 'Delete this part',
    loading: 'Opening the editor',
    loadErrorTitle: 'We could not open the editor',
    loadErrorText: 'Check your connection and try again.',
    scoreLoading: 'Loading the score',
    // The one line at the end of the page line: the most important problem first.
    status: {
      // Takes the part name and the two bar counts.
      partBars: (name: string, partBars: number, pieceBars: number) =>
        `${name} has ${partBars} ${partBars === 1 ? 'bar' : 'bars'}; the piece has ${pieceBars}.`,
      openStructure: 'Fix its bars',
      // The bar-count guide (Decisions 2026-11-03): a misread part is pointed at its own fixes, never at a piece edit.
      guideMisread: (name: string, diff: number) =>
        diff < 0
          ? `Probably misread: ${-diff} ${diff === -1 ? 'bar' : 'bars'} missing in ${name}, often a multi-rest read as one bar.`
          : `Probably misread: ${diff} ${diff === 1 ? 'bar' : 'bars'} too many in ${name}, often a bar line read where there is none.`,
      guidePiece: (agree: number, others: number) =>
        `${agree} of the ${others} other parts have this count too, so the piece may be wrong.`,
      editPiece: 'Edit piece structure',
      unmatched: (count: number) => `${count} ${count === 1 ? 'bar has' : 'bars have'} no time in the recording yet.`,
      structureChanged: 'The structure changed since the last realign.',
      filling: 'Finding times for the empty bars…',
      // The fill found no time for them: said after the count of bars with no time.
      noRoom: 'The recording shows no room for them where they are, so the play order may not match it.',
      filled: (count: number) => `${count} ${count === 1 ? 'bar was' : 'bars were'} filled in. Marked on the waveform until you check ${count === 1 ? 'it' : 'them'}.`,
      realign: 'Realign',
      realigning: 'Realigning…',
      // What Realign does, for the hover tip: confirmed locators (checked as Sounds right, dragged or added by hand) are its fixed anchors.
      realignTip: 'Matches the bars to the recording again. Bars you checked or moved by hand stay where they are; only the others can move.',
      realignFailed: 'Realign did not finish. Please try again.',
      // The job finished but its result could not be read here: the screen still shows the old times, and saving now would replace the refit.
      realignReload: 'Realign finished, but this screen could not load the new times. Reload the page before you change anything.',
      // Ten minutes without a change: the job may still be working, so Structure stays locked until it ends.
      realignSlow: 'Realign is taking longer than usual, so Structure stays locked. It may still be working; if nothing changes, reload this page.',
      // What a Delete or Add on the waveform moved (UX part 10): the bars by their old numbers, and the bars the recording filled in after.
      shifted: (
        moved: { first: string; last: string; count: number; direction: 'back' | 'forward' },
        filled: { first: string; last: string; count: number } | null,
      ) => {
        const bars = moved.count === 1 ? `Bar ${moved.first}` : `Bars ${moved.first} to ${moved.last}`
        const fill = filled === null ? '' : `; ${filled.count === 1 ? `bar ${filled.first}` : `bars ${filled.first} to ${filled.last}`} filled from the recording`
        return `${bars} moved one bar ${moved.direction}${fill}.`
      },
      moved: (count: number) => `${count} bar ${count === 1 ? 'line' : 'lines'} moved by hand. Not resolved yet.`,
      // After a play order edit that relabelled the locators (Task 18): the times are right and the labels were off.
      relabeled: (count: number) =>
        count === 1
          ? '1 locator was relabelled to follow the play order. Its time did not move. It is unchecked again.'
          : `${count} locators were relabelled to follow the play order. Their times did not move. Relabelled ones are unchecked again.`,
    },
    ipad: {
      notice: 'Editing works best on a computer.',
      dismiss: 'Dismiss',
    },
    // A phone has no editor (Decisions 2026-11-08): the pop-up its edit buttons open, and the page its editor address shows.
    phone: {
      title: 'Editing needs a bigger screen',
      text: 'Open this piece on a computer or tablet to edit it.',
      back: 'Back',
      practice: 'Practice',
      pieceHub: 'Back to the piece',
    },
  },

  // The owner's Share dialog (spec 5.6).
  share: {
    title: 'Share this piece',
    explanation: "Let other musicians practice this piece. They can't change it.",
    linkLabel: 'Share link',
    copy: 'Copy',
    copied: 'Copied',
    switchLabel: 'Anyone with the link can join',
    linkOff: 'This link is off. Nobody new can join.',
    reset: 'Reset link',
    resetHint: 'Makes a new link. The old link stops working. People who already joined keep their access.',
    resetQuestion: 'The old link will stop working. People who already joined keep access.',
    // Asked once per piece, the first time its link is turned on (the music rule, Decision 2026-11-06).
    rightsTitle: 'Before you share this piece',
    rightsBody: 'Please confirm that this piece is your own music, in the public domain, or used with permission.',
    rightsTick: 'I confirm',
    rightsConfirm: 'Turn on sharing',
    resetConfirm: 'Reset link',
    members: 'Members',
    noMembers: 'Nobody has joined yet.',
    joined: (date: string) => `Joined ${date}`,
    // The member limit (migration 0014): how many joined, the people on hold among them, and the limit.
    memberCount: (count: number, limit: number) => `${count} of ${limit} members`,
    overLimit: (limit: number, held: number) =>
      `This piece is over its limit of ${limit} members. ${held === 1 ? 'The person who joined last is' : `The ${held} people who joined last are`} on hold until there is room. Remove someone to let them in.`,
    onHold: 'On hold',
    remove: 'Remove',
    removeLabel: (name: string) => `Remove ${name}`,
    removeQuestion: (name: string) =>
      `Remove ${name}? They lose access to this piece. They can join again with the link. To stop that, reset the link.`,
    removeConfirm: 'Remove',
    cancel: 'Cancel',
    loading: 'Loading…',
    failed: 'We could not do that. Please try again.',
    close: 'Close',
  },

  // Opening a share link (spec 5.3).
  join: {
    title: "This link can't open the piece",
    loading: 'Opening the piece…',
    linkOff: 'This link is turned off. Ask the person who shared it with you.',
    full: 'This piece is full. Ask its owner to make room for you.',
    // A member who opens the link again while they are on hold.
    onHold: 'You are on hold: this piece is full. You get access again when its owner makes room.',
    notFound: "This link doesn't work any more. Ask for a new one.",
    failed: 'We could not open this link. Please try again.',
  },

  // Settings (task 4.8). The board writes the section names in capitals; the page does that with CSS.
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    lightMode: 'Light mode',
    lightModeHint: 'Use a light background across the app.',
    nightScore: 'Night score',
    nightScoreHint: 'Show the score as white notes on black.',
    barNumbers: 'Bar numbers over the staff',
    barNumbersHint: 'Show the bar numbers, and the range on a multi-bar rest, on the score in Practice and in the Editor.',
    following: 'Following the music',
    scrolling: 'Scrolling',
    scrollByLine: 'By line',
    scrollByPage: 'Page turns',
    box: 'Box around the playing bar',
    boxColours: 'Colour of the box',
    line: 'Gliding line inside the bar',
    lineColours: 'Colour of the gliding line',
    colourNames: { violet: 'Violet', teal: 'Teal', amber: 'Amber', pink: 'Pink', blue: 'Blue' },
    loopSection: 'Loop',
    loop: 'Loop colour',
    loopHint: 'The looped bars on the score and the loop marks on the waveform',
    loopColours: 'Colour of the loop',
    loopShow: 'Show the loop colour',
    // Editing: what the Editor does by itself once the player has shown it the beat by ear. Plain words, no jargon.
    editing: 'Editing',
    continueMode: 'Continue from my bars',
    continueModeHint: 'After you check 3 bars in a row by ear, the app can place the next bar lines on the beats the same way.',
    continueAsk: 'Ask me',
    continueButton: 'Button only',
    continueAuto: 'Automatically',
    autoRegrid: 'Fix a wrong beat by itself',
    autoRegridHint:
      "When the recording's beat does not match the score (one beat a bar in a fast 3/4), put the bar lines on the beats when you open the Editor. You can undo it.",
    keyCommands: 'Key commands',
    keyboardShortcuts: 'Keyboard shortcuts',
    // Read-only for now (Erez, 2026-11-06): the list tells what the keys do, it does not rebind them. `more` is the count of the other Editor-only entries.
    shortcutsHint: (more: number) => `Space to play or pause, N for the next problem, and ${more} more for the Editor.`,
    shortcutsShow: 'Show',
    shortcutsDone: 'Done',
    shortcutGroups: { both: 'Editor and Practice', editor: 'Editor only' },
    // Its own list: what each key does today in Practice and the Editor, in the order of the board plus the keys the code has and the board leaves out.
    shortcuts: [
      { group: 'both', action: 'Play / pause', keys: 'Space' },
      { group: 'editor', action: 'Move', keys: 'V' },
      { group: 'editor', action: 'Add bar line', keys: 'B' },
      { group: 'editor', action: 'Delete bar line', keys: 'X' },
      { group: 'editor', action: 'Next problem', keys: 'N' },
      { group: 'editor', action: 'Resolved, while a locator is moved', keys: 'R' },
      { group: 'editor', action: 'Snap to previous / next beat', keys: ', / .' },
      { group: 'editor', action: 'Snap to closest beat', keys: '/' },
      { group: 'editor', action: 'Select several bar lines', keys: 'Drag, or Shift + click' },
      { group: 'editor', action: 'Next time through a repeated bar', keys: 'Double click' },
      { group: 'editor', action: 'Previous / next bar, line above / below', keys: '← → ↑ ↓' },
      { group: 'editor', action: 'Clear the selection', keys: 'Esc' },
      { group: 'editor', action: 'Undo', keys: 'Cmd/Ctrl + Z' },
      { group: 'editor', action: 'Redo', keys: 'Shift + Cmd/Ctrl + Z' },
      { group: 'editor', action: 'Zoom score', keys: '+ / −' },
      { group: 'editor', action: 'Zoom waveform', keys: 'Shift + / −' },
      { group: 'editor', action: 'Add locator on / off', keys: 'L' },
      { group: 'editor', action: 'Delete the selected locator', keys: 'Delete' },
    ] as readonly { group: 'both' | 'editor'; action: string; keys: string }[],
    handsFree: 'Hands free',
    // Static for now: whether the pedal is named here is still open, so the text is the board's.
    keys: [
      { action: 'Play / pause', keys: 'Space, or pedal' },
      { action: 'Restart loop', keys: 'Left arrow, or pedal' },
      { action: 'Next loop', keys: 'Right arrow, or pedal' },
    ],
    account: 'Account',
    terms: 'Terms of use',
    admin: 'Admin',
    language: 'Language: English',
    signOut: 'Sign out',
    saveFailed: 'We could not save that change. Please try again.',
    signOutFailed: 'We could not sign you out. Please try again.',
    // Delete account (Decision 2026-11-05): a button, then two messages. Plain words; "pieces" is what the app calls them.
    deleteAccount: 'Delete account',
    deleteAccountLabel: 'Delete your account',
    deleteAccountHint: 'Deletes your pieces and your account for good.',
    adminCannotDelete: 'This is the admin account, so it cannot be deleted: the app has no way to add another admin.',
    cancel: 'Cancel',
    deleteAccountDialog: {
      firstTitle: 'Delete your account?',
      firstText:
        'All your pieces will be deleted, with their scores, recordings and maps. Anyone you shared a piece with will lose access to it. Pieces other people shared with you are not deleted. This cannot be undone.',
      pieceCount: (count: number) => (count === 0 ? 'You have no pieces of your own.' : count === 1 ? 'You have 1 piece of your own.' : `You have ${count} pieces of your own.`),
      continue: 'Continue',
      secondTitle: 'Are you sure?',
      secondText: 'Your account and everything in it will be deleted now. There is no way to get it back.',
      confirm: 'Delete my account',
      deleting: 'Deleting',
      // Each says which step stopped and that the account is still there, so trying again is safe.
      failed: {
        busy: 'A piece is still being prepared, so nothing was deleted. Try again when it is done.',
        check: 'We could not check your pieces, so nothing was deleted. Your account is still here. Please try again.',
        pieces: 'We could not delete all your pieces. Some may already be gone. Your account is still here, and trying again is safe.',
        files: 'Your pieces are deleted, but we could not clear the PDFs waiting to be split. Your account is still here, and trying again is safe.',
        account: 'Your pieces are deleted, but we could not delete your account. It is still here, and trying again is safe.',
      },
    },
  },

  // The admin hub (plans and usage limits, Erez 2026-11-08; the prototype's boards PlansAdminPlans and PlansAdminPeople): Plans and
  // People, one staged draft, one Save changes.
  admin: {
    title: 'Admin',
    loading: 'Loading the admin hub',
    loadErrorTitle: 'We could not load the admin hub',
    loadErrorText: 'Check your connection and try again.',
    tabsLabel: 'Admin',
    tabPlans: 'Plans',
    tabPeople: 'People',
    // The sticky bar under the tabs.
    bar: {
      label: 'Changes to save',
      none: 'No changes',
      unsaved: (n: number) => (n === 1 ? '1 unsaved change' : `${n} unsaved changes`),
      saved: 'Saved',
      fix: 'Fix the marked numbers, then save',
      failed: 'We could not save. Nothing was changed, and your changes are still here. Please try again.',
      saving: 'Saving',
      discard: 'Discard changes',
      save: 'Save changes',
    },
    // The question before Save, only for a removal or a pause.
    confirm: {
      title: (n: number) => `Save ${n === 1 ? '1 change' : `${n} changes`}?`,
      removes: (n: number) => `This removes ${n === 1 ? '1 person' : `${n} people`}. Their pieces and shares stay; anything new follows Trial's limits.`,
      pauses: (names: string[]) => `This pauses new pieces on ${names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}.`,
      keepEditing: 'Keep editing',
      save: 'Save changes',
      failed: 'We could not save. Nothing was changed, and your changes are still here. Please try again.',
    },
    // The question before leaving with changes.
    leave: {
      title: 'Leave without saving?',
      text: (n: number) => `Your ${n === 1 ? 'change is' : `${n} changes are`} lost.`,
      stay: 'Stay',
      leave: 'Leave',
      failed: 'We could not leave this page. Please try again.',
    },
    // Plans.
    plansIntro:
      'Each plan holds every limit. Make your changes on Plans and People, then Save changes applies them all at once. Anyone without another plan is on Trial. The admin is never limited.',
    people: (n: number) => (n === 1 ? '1 person' : `${n} people`),
    cardChanges: (n: number) => (n === 1 ? '1 unsaved change' : `${n} unsaved changes`),
    cardEdit: 'Edit',
    cardClose: 'Close',
    // The line under a plan's name: a few of its limits, from the saved plan.
    summary: {
      created: (n: number | null) => (n === null ? 'Pieces: no limit' : n === 1 ? '1 piece ever' : `${n} pieces ever`),
      parts: (n: number | null) => (n === null ? 'any number of parts' : n === 1 ? '1 part each' : `${n} parts each`),
      advancedReading: (on: boolean) => `Advanced Reading ${on ? 'on' : 'off'}`,
      shared: (n: number | null) => (n === null ? 'sharing: no limit' : n === 1 ? '1 shared piece' : `${n} shared pieces`),
      paused: 'new pieces paused',
    },
    groups: {
      pieces: 'Pieces',
      size: 'Size',
      ai: 'AI features',
      sharing: 'Sharing',
      reprocess: 'Reprocess',
      planWide: 'Plan-wide',
    } satisfies Record<LimitGroup, string>,
    // One entry per limit (a test fails when one is missing): its label, and the hint under it.
    limits: {
      pieces_created_max: { label: 'Pieces created, ever', hint: 'Deleting a piece does not give one back.' },
      pieces_stored_max: { label: 'Pieces stored at once', hint: 'Pieces in the library at the same time.' },
      parts_per_piece_max: { label: 'Parts per piece' },
      pages_per_part_max: { label: 'Pages per part PDF', hint: "At most 100, the app's own limit." },
      recording_minutes_max: { label: 'Recording length, minutes', hint: "At most 20, the app's own limit." },
      advanced_reading: { label: 'Advanced Reading', hint: 'Spends the Anthropic key on every page it reads.' },
      advanced_reading_parts_per_month: { label: 'Advanced Reading parts per month' },
      split_pdf: { label: 'Split a multi-part PDF', hint: 'Reads the page headers with a vision model.' },
      suggest_name: { label: 'Suggest a name', hint: 'One small model call each time.' },
      shared_pieces_max: { label: 'Pieces with the share link on' },
      members_per_piece: { label: 'Members per piece', hint: 'At most 500.' },
      members_per_part: {
        label: 'Members per part',
        hint: 'A piece takes the larger of the two: members per piece, or members per part times its parts. At most 100.',
      },
      read_again_per_part_max: { label: 'Reprocess a part, times per part' },
      realign_per_piece_max: { label: 'Realign, times per piece' },
      new_pieces_per_day: { label: 'New pieces per day, all users of the plan' },
      new_pieces_paused: { label: 'Pause new pieces', hint: 'Nobody on this plan can make a new piece until you turn this off.' },
    } satisfies Record<LimitKey, { label: string; hint?: string }>,
    // The daily limit's hint: today's count on the plan, and the saved limit.
    newPiecesToday: (today: number, max: number | null) => (max === null ? `New pieces today: ${today}.` : `New pieces today: ${today} of ${max}.`),
    noLimit: 'No limit',
    noLimitFor: (label: string) => `${label}: no limit`,
    noLimitPlaceholder: 'None',
    on: 'On',
    off: 'Off',
    changedWas: (was: string) => `Changed, was ${was}`,
    wasNoLimit: 'no limit',
    wasOn: 'on',
    wasOff: 'off',
    // Under a number that cannot be saved.
    fix: (reason: string) => `Fix: ${reason}`,
    fixRange: (min: number, max: number) => `a whole number from ${min} to ${max}.`,
    fixMin: (min: number) => `a whole number, ${min} or more.`,
    // People.
    peopleIntro:
      'Everyone who has signed in, and the emails you gave a plan before their first sign-in. Anyone without another plan is on Trial. Changes here wait for Save changes.',
    addTitle: 'Give someone a plan',
    emailLabel: 'Email address',
    emailPlaceholder: 'name@example.com',
    planLabel: 'Plan',
    add: 'Add',
    invalid: 'Enter an email address.',
    duplicate: 'Already on the list.',
    searchLabel: 'Search people',
    searchPlaceholder: 'Name or email',
    filterPlan: 'Plan',
    filterStatus: 'Status',
    filterUsage: 'Usage',
    all: 'All',
    signedIn: 'Signed in',
    notSignedIn: 'Not signed in yet',
    atLimit: 'At a limit',
    nearLimit: 'Near a limit',
    unsavedOnly: 'Unsaved changes only',
    sortLabel: 'Sort',
    sorts: {
      signInNewest: 'Last sign-in, newest first',
      signInOldest: 'Last sign-in, oldest first',
      email: 'Email, A to Z',
      plan: 'Plan',
    },
    showing: (shown: number, all: number) => `Showing ${shown} of ${all} people`,
    clearFilters: 'Clear filters',
    exportLabel: (n: number) => `Export ${n === 1 ? '1 person' : `${n} people`} (CSV)`,
    exportNote: 'Unsaved changes are not in the export.',
    exported: (n: number, file: string) => `Exported ${n === 1 ? '1 person' : `${n} people`} to ${file}`,
    noMatch: 'No people match these filters.',
    peopleList: 'People',
    // A person's row.
    adminPlan: 'Admin',
    noName: '—', // someone who signed up with no name
    planFor: (email: string) => `Plan for ${email}`,
    remove: 'Remove',
    removeLabel: (email: string) => `Remove ${email}`,
    undo: 'Undo',
    undoLabel: (email: string) => `Undo the change for ${email}`,
    tagNew: 'New',
    tagPlanChanged: (was: string, now: string) => `Plan changed: ${was} to ${now}`,
    tagRemoved: 'Will be removed',
    // The last sign-in in words (the domain gives the kind and the numbers).
    signedInToday: 'Signed in today',
    signedInYesterday: 'Signed in yesterday',
    signedInDaysAgo: (n: number) => `Signed in ${n} days ago`,
    signedInOn: (day: number, month: number, year: number, thisYear: number) =>
      `Signed in ${day} ${MONTHS[month - 1]}${year === thisYear ? '' : ` ${year}`}`,
    // The usage line.
    usageNone: 'No pieces yet',
    usageMade: (made: number, max: number, plan: string) => `${made} of ${max} ${plan.toLowerCase()} pieces used`,
    usageStoredOf: (stored: number, max: number) => `${stored} of ${max} pieces stored`,
    usageStored: (stored: number) => (stored === 1 ? '1 piece' : `${stored} pieces`),
    usageShared: (shared: number, max: number | null) => (max === null ? `${shared} shared` : `${shared} shared of ${max}`),
  },

  // The Practice screen (task 7.6): its top bar, the score picking, the overview strip and the toolbar.
  practice: {
    pieceHub: 'Hub',
    loading: 'Opening Practice',
    loadErrorTitle: 'We could not open Practice',
    loadErrorText: 'Check your connection and try again.',
    scoreLoading: 'Loading the score',
    noRecording: 'This piece has no recording to play yet.',
    recordingFailed: 'The recording could not be loaded. Reload the page and try again.',
    // Picking a range on the score.
    pickHint: 'Tap the last bar of the loop, or this bar again for one bar',
    passQuestion: (bar: string) => `Which time through bar ${bar}?`,
    // "1st time", "2nd time", "3rd time", "4th time" (pass is 1 for the first).
    passChoice: (pass: number) => {
      const suffix = pass % 100 >= 11 && pass % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[pass % 10] ?? 'th'
      return `${pass}${suffix} time`
    },
    passNoTime: 'This time through has no time in the recording yet',
    rangeNotPlayed: 'The loop must end at a bar that is played after its first bar.',
    loopStart: 'Loop start',
    loopEnd: 'Loop end',
    // The overview strip under the score.
    overview: 'Recording overview',
    loopBand: (label: string) => `Loop ${label}`,
    // The toolbar.
    toolbar: 'Practice controls',
    collapse: 'Hide the controls',
    expand: 'Show the controls',
    moreControls: 'More controls',
    fit: 'Fit',
    fitScore: 'Fit the score to the width',
    fewerControls: 'Fewer controls',
    restart: 'Restart the loop',
    loop: 'Loop',
    loopRange: 'Loop range',
    rangePlaceholder: '13–24',
    rangeErrors: {
      format: 'Type one bar or two, for example 13 or 13–24.',
      'unknown-bar': 'This piece has no such bar.',
      order: 'The loop must end after it starts.',
    },
    bar: (bar: string) => `Bar ${bar}`,
    noBar: 'Bar –',
    time: (now: string, total: string) => `${now} / ${total}`,
    countBeat: (beat: number, of: number) => `Count-in, beat ${beat} of ${of}`,
    metronome: 'Metronome',
    metronomeSwitch: 'Metronome on',
    tone: (name: string) => `Tone: ${name}`,
    toneMenu: 'Metronome tone',
    tones: { wood: 'Wood', click: 'Click', beep: 'Beep' } as Record<string, string>,
    metronomeVolume: 'Metronome volume',
    musicVolume: 'Music volume',
    muteMusic: 'Mute the music',
    unmuteMusic: 'Unmute the music',
    countIn: (label: string) => `Count-in: ${label}`,
    countInMenu: 'Count-in',
    countInSettings: 'Count-in settings',
    countInOff: 'Off',
    countInBars: (bars: number) => (bars === 1 ? '1 bar' : `${bars} bars`),
    countInBarsGroup: 'Bars of count-in',
    // The word after the four number buttons of the count-in length.
    countInBarsWord: 'bars',
    tempoSource: 'Count-in tempo',
    tempoSources: { 'loop-first-bar': "Loop's first bar", 'bar-before': 'Bar before the loop' } as Record<string, string>,
    countInEveryRepeat: 'Count in every repeat',
    // The speed panel: a slider from a quarter to double speed (boards: Practice.png).
    speedHeading: 'Speed',
    speedValueText: (rate: number) => `${Math.round(rate * 100) / 100} times`,
    backToNormalSpeed: 'Back to 1×',
    partMenu: 'Part',
    stems: 'Stems',
    // Playback (Decision 2026-10-30): how the recording comes in with a count-in, and the count on the score.
    playback: 'Playback',
    playbackMenu: 'Playback settings',
    saveFailed: 'We could not save that change. Please try again.',
    countInFade: 'Fade the music in on a count-in',
    countInFades: {
      off: 'Off',
      'pre-roll': 'Pre-roll',
      'pre-roll-and-loop': 'Pre-roll and loop start',
      'under-clicks': 'Under the clicks',
    },
    showCount: 'Show count-in beats',
    countInMetronome: 'Count-in Metronome',
    loopCountIn: 'Loop count-in',
    soon: 'Soon',
    // The hands-free keys, as KeyboardEvent.key values (Settings lists them for the user). A Bluetooth page-turn pedal sends PageUp and PageDown.
    keyMap: { playPause: [' '], restartLoop: ['ArrowLeft', 'PageUp'], nextLoop: ['ArrowRight', 'PageDown'] },
  },

  // The Editor's Structure panel (task 5.5): bars, meters, play order and marks, with "Edit as text".
  structure: {
    title: 'Structure',
    editAsText: 'Edit as text',
    apply: 'Apply',
    // Shown over the forms while a realign runs: Structure edits would be overwritten by its result.
    busy: 'Realigning… Structure can be changed when it is done.',
    sections: { bars: 'Bars', meters: 'Meters', playOrder: 'Play order', marks: 'Marks', partBars: 'Bars', rests: 'Rests' },
    // The two groups of tabs (Decisions 2026-11-03): the piece's structure, shared by every part, and the open part's own.
    groups: { piece: 'Piece · all parts', pieceOnePart: 'Piece', part: (name: string) => `This part · ${name}`, partLabel: 'This part' },
    // The card on every Piece tab; its switch is the toolbar's, one state.
    safety: {
      title: 'Edit piece structure',
      locked: 'The piece is locked. Turn this on to change its bars.',
      on: 'On. Changes here apply to the whole piece and every part.',
    },
    partBarsHeading: (name: string) => `Bars · ${name}`,
    bars: {
      pieceTitle: 'Bars in the piece',
      partTitle: 'Bars in this part',
      detected: 'Detected:',
      now: 'Now:',
      // The numbered bars; the pickups (the top one, and any with no number of their own) are named after them.
      count: (printed: number, pickups = 0) =>
        `${printed} ${printed === 1 ? 'bar' : 'bars'}${pickups === 0 ? '' : pickups === 1 ? ' + pickup' : ` + ${pickups} pickups`}`,
      insertLabel: 'Insert a bar',
      side: 'Insert before or after the bar',
      before: 'Before',
      after: 'After',
      barPlaceholder: 'Bar',
      insertField: 'Bar to insert at',
      insertApply: 'Apply',
      removeLabel: 'Remove bar',
      removeField: 'Bar to remove',
      removeApply: 'Remove',
      pieceNote: 'Changes the piece only, not the parts.',
      partNote: 'Changes this part only. The piece and the other parts keep their bars.',
      // The recording times a plain insert or remove would clear.
      dropped: (count: number) => `${count} recording ${count === 1 ? 'time' : 'times'} will be cleared; Realign refits them.`,
      // Why a part's Insert or Remove was refused (see domain/partBars.ts).
      refusals: {
        'no-box': 'This part has no such bar.',
        'in-multi-rest': 'This box holds several bars. Change that with Bars in this box on the score.',
        'too-narrow': 'This box is too narrow to split. Draw the bar line on the score instead.',
        'line-end': 'This bar has no neighbour on its staff line to merge with. Delete its bar line on the score instead.',
        'only-bar': 'This part has one bar, so it cannot lose it.',
      } as Record<string, string>,
    },
    pickup: {
      title: 'Pickup bars',
      none: 'No pickup bar detected',
      present: 'Pickup bar',
      // The chip: how many pickup bars the piece has, the top one and the ones in the middle.
      count: (count: number) => (count === 1 ? '1 pickup bar' : `${count} pickup bars`),
      hint: 'Missed a pickup? Add one at the top of the piece or before any bar.',
      add: 'Add a pickup bar',
      row: 'Top of the piece',
      // One row of the box: "Before bar [7]". A pickup in the middle has no number of its own and reads p7 on screen.
      before: 'Before bar',
      beforeField: 'Pickup before bar',
      barPlaceholder: 'Bar',
      // A row that is not set yet: the player types the bar, then sets it.
      set: 'Set',
      removeDraft: 'Remove this row',
      length: 'Length',
      beats: (units: number, numerator: number) => `${units === 1 ? 'beat' : 'beats'} of ${numerator}`,
      shorter: 'Shorter pickup',
      longer: 'Longer pickup',
      remove: 'Remove the pickup bar',
      // Why a pickup bar was not added; the first bar is the top of the piece, so it has its own row.
      refusals: {
        'pickup-edge': 'A pickup bar cannot be the last bar. Pick an earlier bar.',
        'in-multi-rest': 'That bar is inside a multi-bar rest. Change how many bars its box holds first (Bars in this box).',
        'already-pickup': 'That bar is a pickup bar already.',
        'next-to-pickup': 'A pickup bar cannot sit next to another one.',
        invalid: 'That pickup bar is not possible. Pick a bar of the piece.',
      } as Record<string, string>,
      topTaken: 'The top of the piece has a pickup bar already.',
      // Beats are the notes of the meter's denominator: eighths in 6/8.
      foot: (numerator: number, denominator: number) =>
        `Length is in beats of the time signature (${numerator}/${denominator} here)${denominator === 4 ? '' : `, counted in ${noteNames[denominator] ?? `1/${denominator} notes`}`}.`,
      notPossible: 'The piece needs a second bar to have a pickup before it.',
    },
    partPickup: {
      none: 'No pickup box',
      present: 'Pickup bar',
      has: 'This part has its pickup bar (p1).',
      noPiece: 'The piece has no pickup bar. Add it on the Piece tab.',
      ask: 'The piece has a pickup bar, but this part has no pickup box (p1). Which fits this part?',
      split: 'Split the first box',
      splitHint: 'The left quarter of the first box becomes the pickup, p1. The other bars keep their numbers.',
      shift: 'The first box is the pickup',
      shiftHint: "This part's boxes, rests and flags move one number down.",
      refusals: {
        'in-multi-rest': 'The first box holds several bars. Change that with Bars in this box on the score.',
        'too-narrow': 'The first box is too narrow to split. Draw the bar line on the score instead.',
        'no-box': 'This part has no first box.',
        'no-piece-pickup': 'The piece has no pickup bar. Add it on the Piece tab.',
        'part-has-pickup': 'This part has its pickup bar (p1).',
      } as Record<string, string>,
    },
    meters: {
      fromBar: 'From bar',
      meter: 'Meter',
      rowFrom: (row: number) => `Meter ${row}: from bar`,
      rowBeats: (row: number) => `Meter ${row}: beats per bar`,
      rowUnit: (row: number) => `Meter ${row}: note value`,
      add: 'Add a meter',
      remove: (row: number) => `Remove meter ${row}`,
    },
    playOrder: {
      play: 'Play bars',
      to: 'to',
      rowFrom: (row: number) => `Row ${row}: from bar`,
      rowTo: (row: number) => `Row ${row}: to bar`,
      add: 'Add a row',
      remove: (row: number) => `Remove row ${row}`,
      moveUp: (row: number) => `Move row ${row} up`,
      moveDown: (row: number) => `Move row ${row} down`,
      played: (count: number) => `${count} ${count === 1 ? 'bar' : 'bars'} played`,
      // One repeated run, e.g. "bars 9-16 twice"; a single bar is "bar 9 twice".
      repeated: (from: string, to: string, times: number) => {
        const bars = from === to ? `bar ${from}` : `bars ${from}-${to}`
        return `${bars} ${times === 2 ? 'twice' : times === 3 ? 'three times' : `${times} times`}`
      },
    },
    marks: {
      none: 'No marks yet.',
      from: 'From bar',
      to: 'to',
      rowFrom: (row: number) => `Mark ${row}: from bar`,
      rowTo: (row: number) => `Mark ${row}: to bar`,
      rowKind: (row: number) => `Mark ${row}: kind`,
      kinds: { fermata: 'Fermata', rest: 'Rest', rit: 'Rit.' },
      // Always shown above the list: the marks are the recording's, the rests are the part's.
      partHint: (part: string) => `Fermata and rit. are for every part. A rest is for ${part || 'this part'} only.`,
      pieceHint: 'Fermata and rit. are for every part.',
      restsHint: (part: string) => `The rests of ${part || 'this part'} only: they follow its own boxes.`,
      // Shown while a row is a rit.; a passage is one row of bars.
      ritHint: 'rit., rall. or accel.: the tempo changes here. Give the first and last bar of the passage.',
      add: 'Add a mark',
      remove: (row: number) => `Remove mark ${row}`,
    },
    text: {
      label: 'Structure as text',
      hint: 'One line each for meters, play order and marks, for every part. Bars can be written 9-16, or 17-end; a pickup bar with no number is written p7. A mark covers one bar or several: fermata 32, rit 30-32. A line "short bars: 44 3/8" gives bar 44 three eighths; the length of the top pickup is written pickup 1/8, and the top pickup itself is added in Pickup bars on the Bars tab. A line "pickups: p7 2/4" lists the pickup bars with no number and their lengths.',
      restsInPiece: 'Rests belong to a part: write them in This part > Rests.',
      // This part > Rests, as one line of bar ranges.
      restsLabel: 'Rests of this part as text',
      restsHint: (part: string) => `The bars ${part || 'this part'} rests, as ranges: 1-4, 46-48, 101. Leave it empty for none.`,
      restsBad: 'Write the rests as bars or ranges, like 1-4, 46-48, 101.',
      pickupChanged: 'To add or remove the top pickup, use Pickup bars on the Bars tab.',
      // A line of the text that could not be read or applied.
      lineError: (line: number, message: string) => `Line ${line}: ${message}`,
      errors: {
        'unknown-line': 'This line should start with meters:, play order: or marks:, once each.',
        'bad-meter': 'Write meters like 4/4 from 1, 2/4 from 49, or none.',
        'bad-range': 'Write the play order like 1-16, 9-16, 17-end, with bars that are in the piece.',
        'bad-mark': 'Write marks like fermata 28, rest 46-48, rit 30-32, or none.',
        'bad-short-bar': 'Write short bars like pickup 1/8, 44 3/8, with the note value of the meter at that bar, or leave the line out.',
        'bad-pickup': 'Write pickups like p7 2/4, p21 1/4, with the note value of the meter at that bar, or leave the line out.',
        'missing-line': 'This line is missing.',
      },
    },
    // What is wrong with a field; the bar count is that of the piece.
    errors: {
      invalidBarField: (min: string, max: string) => `Pick a whole bar from ${min} to ${max}.`,
      onlyBar: 'The piece has one bar, so it cannot lose it.',
      firstMeterNotBar1: 'The first meter starts at bar 1.',
      meterOutOfRange: (last: string) => `Pick a bar from 1 to ${last}.`,
      meterNotIncreasing: 'Each meter starts at a later bar than the one before.',
      badMeter: 'A meter is 1 to 32 beats over a note value of 1, 2, 4, 8, 16 or 32.',
      playOrderEmpty: 'Add at least one row.',
      playOrderOutOfRange: (last: string, first = '1') => `Both bars must be whole numbers from ${first} to ${last}.`,
      playOrderFromAfterTo: 'The first bar cannot come after the last.',
      markOutOfRange: (last: string, first = '1') => `Pick a bar from ${first} to ${last}.`,
      markDuplicate: 'This bar already has this mark.',
      markRangeBackwards: 'The first bar cannot come after the last.',
      shortBarOutOfRange: (last: string, first = 'p1') => `Pick a bar from ${first} to ${last}.`,
      shortBarDuplicate: 'This bar already has a length.',
      shortBarNotShorter: (meter: string) => `A short bar holds fewer notes than a full bar, which is ${meter}.`,
      pickupPlace: 'A pickup bar with no number cannot be the first or the last bar, or sit next to another one.',
    },
  },
  // Review state and locator edits (Phase 6).
  review: {
    // Why a locator edit was refused (the hint line of the editor shows it for a moment).
    refusals: {
      'no-free-slot': 'No bar is free between the neighbouring locators. Add it with the later bars moving on instead (the Renumber switch, or Shift for one click).',
      'out-of-range': 'A locator has to stay between its neighbours, and its label has to be a bar of the play order.',
      'duplicate-time': 'There is already a locator at that time.',
      'not-found': 'That locator is no longer there.',
      moved: 'This locator was moved. Use Resolved to check it, or Undo move.',
    },
    // The Review Queue (task 6.6). Times are m:ss.s; a bar is "12", or "12 (2)" for its second time.
    queue: {
      title: 'Review Queue',
      checked: (checked: number, total: number) => `${checked} of ${total} checked`,
      progress: 'Review progress',
      hide: 'Hide the Review Queue',
      show: 'Show the Review Queue',
      // The badge on the folded queue.
      left: (open: number) => (open === 0 ? 'Nothing left to check' : `${open} ${open === 1 ? 'problem' : 'problems'} left to check`),
      hatched: (count: number) => `Hatched: ${count} moved, waiting for Resolved`,
      movedByYou: (count: number) => `Moved by you: ${count}`,
      // Checks every open flag item and dismisses this part's box flags, in one undoable step (no question: Undo is the safety).
      resolveAll: 'Resolve all',
      empty: 'Nothing to check. Every bar line looks right.',
      list: 'Problems to check',
      checkedMark: 'Checked',
      soundsRight: 'Sounds right',
      resolved: 'Resolved',
      undoMove: 'Undo move',
      useSuggestedEdge: 'Use the suggested edge',
      // Restores the edges the boxes of a line had before Advanced Reading moved them (8.22); the sentence is for when that cannot be done.
      putBack: 'Put back line',
      putBackRefused: 'That line cannot go back as it was.',
      dismissFlag: 'Dismiss',
      // The Wrong beat card's button: the bar lines of the whole piece go on the beats the recording was heard at (it asks nothing: the card is the question).
      putOnBeats: 'Put bar lines on the beats',
      bar: (label: string) => `Bar ${label}`,
      part: (name: string) => `Part: ${name}`,
    },
    chips: {
      crowded: 'Crowded',
      stretched: (factor: number | null) => (factor === null ? 'Stretched' : `Stretched ${factor.toFixed(1)}x`),
      beatCount: 'Beat count',
      weakDownbeat: 'Weak downbeat',
      otherDownbeat: 'Other downbeat',
      pickup: 'Pickup?',
      skippedRepeat: 'Repeat skipped',
      pulse: 'Wrong beat',
      explained: 'Explained by score',
      moved: 'Moved',
      unmatched: 'No time yet',
      part: 'Bar count',
      box: 'Check the box',
    },
    // What a card says when it is opened, worked out from the flag's numbers.
    explain: {
      // The box check's verdicts (Decisions 2026-11-03), then the model's own note. The last two are Advanced Reading's own (8.22).
      box: {
        signature_inside: 'A clef, key or time signature is inside the box',
        starts_late: "The box starts after the bar's first note",
        ends_early: 'The box ends before its bar line',
        ends_late: 'The box runs past its bar line',
        two_bars: 'A bar line runs through this box',
        not_a_bar: 'This box holds no bar',
        read_moved: 'Moved by Advanced Reading',
        read_count: 'Bars changed by Advanced Reading',
      },
      longer: (label: string, factor: string) => `Bar ${label} is ${factor}x longer than the bars around it.`,
      shorter: (label: string, factor: string) => `Bar ${label} is ${factor}x shorter than the bars around it.`,
      beats: (heard: number, notated: number) => `${heard} beats heard, ${notated} notated.`,
      weakDownbeat: (percent: number | null) => (percent === null ? 'The downbeat is weak.' : `The downbeat is weak (${percent}%).`),
      otherDownbeat: (time: string, otherPercent: number, herePercent: number) =>
        `The recording has a bar line at ${time} almost as strong (${otherPercent}%) as this one (${herePercent}%). The bars after this one follow whichever is right.`,
      skippedRepeat: (played: number, written: number) =>
        `The recording skips the repeat here, so its bars are mapped straight through: ${played} bars, not the ${written} the score plays with its repeats.`,
      // The numbers are whole: the beats a bar the recording was heard at, and the score's. One beat a bar reads "every beat".
      pulse: (found: number, expected: number) =>
        `The recording's beat looks like ${found} per bar, not ${expected}. Check the first 3 bars by ear and press Continue, or put the bar lines on ${found === 1 ? 'every beat' : `every ${found} beats`} now. If the recording takes the repeats, set them in Edit piece structure first.`,
      pickupUnsure: 'Is p1 a pickup? Only one reading of the score says it is a short bar before bar 1. If it is not, turn the Pickup off in Structure.',
      pickupNoOnset: 'Both readings of the score say p1 is a pickup, but nothing in the recording starts near where it is placed. Check where it begins.',
      fermata: 'A fermata explains the length.',
      rit: 'A rit. explains the length.',
      uncertainAfterExplained: (time: string, percent: number) => `…but the bar line at ${time} is uncertain (downbeat ${percent}%).`,
      uncertain: (time: string, percent: number) => `The bar line at ${time} is uncertain (downbeat ${percent}%).`,
      moved: (offset: string) => `You moved this bar line by hand (${offset} s). Resolved keeps the new place; Undo move puts it back.`,
      unmatched: (label: string) => `Bar ${label} has no time in the recording yet.`,
    },
  },
  // Advanced Reading (the box check of Decisions 2026-11-03, and the readers and judge of 8.22): an Advanced option on New piece, Add part and Reprocess, off by default, ticked per part.
  boxCheck: {
    advanced: 'Advanced',
    list: 'Advanced Reading for each part',
    tick: 'Advanced Reading (scanned scores)',
    // The tick in every part row of New piece and Add part (the Read again dialog keeps the list above).
    advancedReading: 'Advanced Reading',
    advancedReadingHint: 'More accurate read for scanned music sheets',
  },
  // One PDF that holds several parts: the choice in New piece and Add part, the split screen, and the parts on the Processing screen (UX plan part 8).
  split: {
    modeLabel: 'How the parts come',
    modeEach: 'One PDF per part',
    modeSplit: 'One PDF with several parts',
    hint: 'The pages are cut into parts by the names in their headers. You check the cut before anything is processed.',
    dropZone: 'Choose the PDF that holds all the parts, or drop it here',
    // The processor's limits for one PDF with several parts (pdf_split.py MAX_PAGES) and the 50 MB of any upload.
    dropZoneLimits: 'One PDF. Up to 120 pages and 50 MB.',
    reading: 'Reading the page headers…',
    readFailed: 'The pages of this PDF could not be read. Try again.',
    notPdf: 'This file is not a PDF.',
    title: 'Check the parts',
    // "Los Banditos.pdf has 12 pages."
    intro: (fileName: string, pageCount: number) => `${fileName} has ${pageCount === 1 ? '1 page' : `${pageCount} pages`}. Rename, move or merge the parts, or untick the ones you do not want.`,
    fullScore: 'Full scores (all parts on one page) are not supported yet: upload the parts.',
    chooseAnother: 'Choose another PDF',
    partsList: 'Parts in this PDF',
    partName: 'Part name',
    keep: (name: string) => `Use ${name}`,
    notUsed: 'Not used',
    // The pages that go into a part as runs from page to page: pages 1-3, 5-6 (a page that was discarded is left out).
    pages: (runs: ReadonlyArray<readonly [number, number]>) =>
      `${runs.length === 1 && runs[0][0] === runs[0][1] ? 'page' : 'pages'} ${runs.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(', ')}`,
    page: (number: number) => `Page ${number}`,
    discardPage: (number: number) => `Discard page ${number}`,
    restorePage: (number: number) => `Restore page ${number}`,
    // The X of the only page a part still keeps.
    lastPageKept: 'Untick the part to leave it out',
    startHere: (page: number) => `Start a new part at page ${page}`,
    newPartHere: 'New part here',
    // What a part is called in a button while its name field is empty.
    unnamed: (position: number) => `part ${position}`,
    // The boundary between two neighbouring parts, which lie one above the other: the page moves down into the next part, or up into this one.
    boundaryLabel: (upper: string, lower: string) => `Between ${upper} and ${lower}`,
    pageDown: (page: number, to: string) => `Page ${page} to ${to}`,
    pageUp: (page: number, to: string) => `Page ${page} to ${to}`,
    merge: 'Merge the part below',
    mergeLabel: (upper: string, lower: string) => `Merge ${upper} and ${lower}`,
    confirm: 'Use these parts',
    confirmFirst: 'Check the parts, then press “Use these parts”.',
    problems: {
      none: 'Keep at least one part.',
      nameEmpty: 'Give the part a name.',
      nameTooLong: 'A part name can have at most 80 characters.',
    },
    // The parts chosen from the PDF, back in the form.
    fromPdf: (fileName: string) => `From ${fileName}`,
    change: 'Change the split',
    removePart: 'Remove part',
    // The Processing screen: the part being read, and the part that could not be.
    readingPart: (name: string, position: number, total: number) => (total > 1 ? `Reading ${name} (${position} of ${total})` : `Reading ${name}`),
    couldNotRead: (name: string) => `Could not read ${name}`,
  },
  // The real services (Phase 9.2): what the Supabase clients say when they refuse or cannot do something yet.
  realServices: {
    stillPreparing: 'This piece is still being prepared; try again when it is done.',
    // A 401 from the processor: an ended sign-in and a server that cannot check sign-ins look the same from here.
    notAccepted: 'The server did not accept this request. Reload the page, or sign out and in again, then try once more.',
    cannotStart: 'The server could not start this job right now. Try again in a moment.',
    tooLarge: (name: string) => `${name} is larger than 50 MB.`,
    notARecording: 'This file is not a recording we can read.',
    emptyFile: (name: string) => `${name} is empty.`,
    reprocessOff: 'Reading a part again is not available here yet.',
  },
} as const

/** A bar label with its pass, as on the waveform markers: "12", second pass "12 (2)"; "p7 (2)" for a pickup. */
export function barWithPass(label: string, passIndex = 0): string {
  return passIndex === 0 ? label : `${label} (${passIndex + 1})`
}

/** A step with its bar already named: `bar` is a label ("12", "p7"), never an internal number. */
type NamedStep = Omit<StepLabel, 'bar'> & { bar?: string }

// Each phrase takes the step's label; a step without a bar drops the bar part instead of printing "undefined".
const afterBar = ({ bar }: NamedStep) => (bar === undefined ? '' : ` after bar ${bar}`)
const forBar = ({ bar, passIndex }: NamedStep) => (bar === undefined ? '' : ` for bar ${barWithPass(bar, passIndex)}`)
const ofBar = ({ bar, passIndex }: NamedStep) => (bar === undefined ? '' : ` of bar ${barWithPass(bar, passIndex)}`)

/** "make bar 101 a 4-bar rest", "make bar 18 one bar" (Bars in this box). */
function barsInBoxPhrase(bar: string | undefined, count: number | undefined): string {
  const which = bar === undefined ? 'the box' : `bar ${bar}`
  if (count === undefined) return `set the bars in ${which}`
  return count === 1 ? `make ${which} one bar` : `make ${which} a ${count}-bar rest`
}

const stepPhrases: Record<StepKind, (label: NamedStep) => string> = {
  'add-bar-line': (label) => `add bar line${afterBar(label)}`,
  'delete-bar-line': (label) => `delete bar line${afterBar(label)}`,
  'move-bar-line': (label) => `move bar line${afterBar(label)}`,
  'move-line-start': ({ bar }) => (bar === undefined ? 'move start of line' : `move start of the line at bar ${bar}`),
  'move-line-end': ({ bar }) => (bar === undefined ? 'move end of line' : `move end of the line at bar ${bar}`),
  'insert-piece-bar': ({ bar }) => (bar === undefined ? 'insert bar in the piece' : `insert bar ${bar} in the piece`),
  'remove-piece-bar': ({ bar }) => (bar === undefined ? 'remove bar from the piece' : `remove bar ${bar} from the piece`),
  'set-bars-in-box': ({ bar, count }) => barsInBoxPhrase(bar, count),
  'add-piece-bar-line': (label) => `add bar line${afterBar(label)} in the piece`,
  'delete-piece-bar-line': (label) => `delete bar line${afterBar(label)} in the piece`,
  'set-piece-bars-in-box': ({ bar, count }) => `${barsInBoxPhrase(bar, count)} in the piece`,
  'set-structure': () => 'confirm the piece structure',
  'add-locator': (label) => `add locator${forBar(label)}`,
  'delete-locator': (label) => `delete locator${forBar(label)}`,
  'move-locator': (label) => `move locator${forBar(label)}`,
  'move-locators': ({ count }) => (count === undefined ? 'move locators' : `move ${count} locators`),
  regrid: () => 'put bar lines on the beats',
  'sounds-right': ({ bar, passIndex }) =>
    bar === undefined ? 'mark as sounds right' : `mark bar ${barWithPass(bar, passIndex)} as sounds right`,
  resolved: ({ bar, passIndex }) => (bar === undefined ? 'resolve' : `resolve bar ${barWithPass(bar, passIndex)}`),
  'undo-move': (label) => `undo move${ofBar(label)}`,
  'relabel-locator': (label) => `relabel locator${ofBar(label)}`,
  'resolve-all': () => 'resolve all',
  'edit-meters': () => 'edit meters',
  'edit-play-order': () => 'edit play order',
  'relabel-in-order': ({ count }) => (count === undefined ? 'relabel the locators in play order' : `relabel ${count} ${count === 1 ? 'locator' : 'locators'} in play order`),
  'edit-marks': () => 'edit marks',
  'edit-short-bars': () => 'edit short bars',
  'toggle-pickup': () => 'change the pickup',
  'add-pickup-bar': ({ bar }) => (bar === undefined ? 'add a pickup bar' : `add pickup bar ${bar}`),
  'remove-pickup-bar': ({ bar }) => (bar === undefined ? 'remove a pickup bar' : `remove pickup bar ${bar}`),
  'set-pickup-length': ({ bar }) => (bar === undefined ? 'change the length of a pickup bar' : `change the length of pickup bar ${bar}`),
  'split-part-pickup': () => 'split the first box for the pickup',
  'shift-part-pickup': () => 'make the first box the pickup',
  realign: () => 'realign',
  'fill-bars': () => 'fill the empty bars',
  'resolve-box-flag': ({ bar }) => (bar === undefined ? 'resolve the box flag' : `resolve the box flag on bar ${bar}`),
}

/** The step as a short phrase, e.g. "add bar line after bar 12", "move locator for bar 12 (2)", "realign". */
export function stepText(label: StepLabel, names: BarNames): string {
  const { bar, ...others } = label
  return stepPhrases[label.kind]({ ...others, ...(bar === undefined ? {} : { bar: names.label(bar) }) })
}

/** "Undo: add bar line after bar 12", or strings.history.nothingToUndo for null. */
export function undoTooltip(label: StepLabel | null, names: BarNames): string {
  return label === null ? strings.history.nothingToUndo : `${strings.history.undo}: ${stepText(label, names)}`
}

/** "Redo: ...", or strings.history.nothingToRedo for null. */
export function redoTooltip(label: StepLabel | null, names: BarNames): string {
  return label === null ? strings.history.nothingToRedo : `${strings.history.redo}: ${stepText(label, names)}`
}
