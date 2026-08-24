from cadsemantics.contracts import EvidenceBundle, EvidenceRef


def assemble_bundle(
    *,
    supporting: tuple[EvidenceRef, ...] = (),
    opposing: tuple[EvidenceRef, ...] = (),
    excluding: tuple[EvidenceRef, ...] = (),
    missing_required: tuple[str, ...] = (),
) -> EvidenceBundle:
    return EvidenceBundle.create(
        supporting=supporting,
        opposing=opposing,
        excluding=excluding,
        missing_required=missing_required,
    )

