"""The model behind the site, and the four objects that use it (the vault's Knowledge OS Plugin Plan 2026-10).

`wire(cfg, vault)` builds one Model for the provider in the settings and, from it, the grader, the bank writer, the tutor
(which the coach shares) and Teach's model. The trust gate decides whether that model may grade and play Teach; the
coach, the tutor and the bank writer keep their own checks (a quote kept only when it is in the note, a bank saved only
when its evidence is). `serve` wires the app once at start; the Settings page rewires it when the model changes.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import trust
from .banks import ModelBankWriter
from .grade import make_grader
from .ledger import Ledger
from .providers import Model, make_model
from .tutorllm import GatedTutor, make_tutor


@dataclass
class Wiring:
    model: Model
    grader: object
    bank_writer: object
    tutor: object
    teach_llm: object


def wire(cfg, vault, environ=None) -> Wiring:
    model = make_model(cfg, ledger=Ledger(vault.learn), environ=environ)
    ready = model.preset is not None and not model.missing
    writer = ModelBankWriter(model, vault.RB.validate_bank) if ready else None
    tutor = make_tutor(cfg, model)
    teach_llm = tutor if (not ready or cfg.grader == "self" or trust.trusted(model, "teach")) else GatedTutor(tutor)
    grader = make_grader(cfg, model, trusted=lambda m: trust.trusted(m, "grader"))
    return Wiring(model, grader, writer, tutor, teach_llm)
