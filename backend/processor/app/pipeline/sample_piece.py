from dataclasses import dataclass
from typing import Literal

# The sample piece: one piece of the admin's, copied once into every account (migration 0016).
# This module holds the decision and the errors the database raises; the copying is in
# app/sample_piece.py.

Outcome = Literal["given", "skipped", "already"]


class SampleAlready(Exception):
    """The account was given or skipped the sample before (sample:already)."""


class SampleNoMaster(Exception):
    """There is no master piece to copy (sample:no_master)."""


@dataclass(frozen=True)
class SampleState:
    """What service_sample_state says about one account."""

    given_at: str | None
    has_master: bool
    is_master_owner: bool
    room: bool


def decide(state: SampleState) -> Literal["copy", "skip", "no_master", "already"]:
    """already when given before; no_master when there is nothing to copy yet (the account is not
    marked and is asked again); skip when the user owns the master or has no room (the account is
    marked and not asked again); else copy."""
    if state.given_at is not None:
        return "already"
    if not state.has_master:
        return "no_master"
    if state.is_master_owner or not state.room:
        return "skip"
    return "copy"
