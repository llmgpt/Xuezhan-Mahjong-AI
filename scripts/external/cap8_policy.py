"""Discard-only cap-eight ablation; the original advanced module is untouched.

Only cloned select_a_card_to_discard -> discard calls see the score proxy.
All other functions retain their original objects and original globals, so
check_hu/check_pong/check_kong and the estimation helpers cannot see this cap.
This is one experimental utility change, not a complete V1 scoring model.
"""

from functools import update_wrapper
from types import FunctionType, SimpleNamespace

import advanced_policy


class _DiscardScore:
    __slots__ = ("_original",)

    def __init__(self, original):
        self._original = original

    def compute_handScore(self, *args, **kwargs):
        return min(self._original.compute_handScore(*args, **kwargs), 8)

    def __getattr__(self, name):
        return getattr(self._original, name)


def _with_global(function, name, value):
    private_globals = dict(function.__globals__)
    private_globals[name] = value
    clone = FunctionType(
        function.__code__, private_globals, function.__name__,
        function.__defaults__, function.__closure__,
    )
    clone.__kwdefaults__ = function.__kwdefaults__
    return update_wrapper(clone, function)


def load_policy():
    # Revalidate even when the public advanced loader already cached its module.
    advanced_policy.verify_vendor()
    original = advanced_policy.load_policy()
    discard = _with_global(original.discard, "score", _DiscardScore(original.score))
    select = _with_global(original.select_a_card_to_discard, "discard", discard)
    facade = SimpleNamespace(**vars(original))
    facade.discard = discard
    facade.select_a_card_to_discard = select
    return facade
