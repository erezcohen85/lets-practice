import { type DemoCredit } from '@/lib/demo/demoBundle'
import { strings } from '@/strings'

/**
 * The credits of the landing film. Its music is the /demo bundle's recording (CC BY 3.0) and its pages that bundle's
 * score, so these are the bundle's own credits (public/demo/gondola-song/demo.json); only the note on how the recording
 * was used differs. A test keeps the two the same.
 */
export const FILM_CREDITS: DemoCredit[] = [
  {
    what: 'Recording',
    who: 'FAE Piano cafe',
    title: 'Mendelssohn Venetianisches Gondellied op.30 no.6',
    source:
      'https://commons.wikimedia.org/wiki/File:FAE_Piano_cafe_-_Mendelssohn%27s_Songs_Without_Words,_Book_2,_Op._30,_No._6,_Allegretto_tranquillo_(Venetian_Boat_Song_No._2),_MWV_U_110.ogg',
    licence: 'CC BY 3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    note: strings.landing.film.creditNote,
  },
  {
    what: 'Score',
    who: 'Breitkopf & Härtel edition, scan from IMSLP',
    source: 'https://imslp.org/wiki/Special:ReverseLookup/109643',
    licence: 'public domain',
  },
]
