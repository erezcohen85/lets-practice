import { type PeopleQuery } from '@/domain/peopleList'

/** The search and filters all off. */
export const NO_FILTERS: Omit<PeopleQuery, 'sort'> = { search: '', plan: 'all', status: 'all', usage: 'all', unsavedOnly: false }
/** What People starts with: no filter, the last sign-in newest first. */
export const DEFAULT_QUERY: PeopleQuery = { ...NO_FILTERS, sort: 'signInNewest' }
