export type CadQuantityKind =
  | 'drawing_occurrences'
  | 'bom_attribute'
  | 'measured_length'
  | 'annotation_occurrences'
  | 'text_frequency'
  | 'unknown'

export interface CadQuantityContract {
  quantity_kind: CadQuantityKind
  quantity_basis: 'drawing_occurrence' | 'bom_declared' | null
  quantity_basis_enum: 'QuantityBasis.DRAWING_OCCURRENCE' | 'QuantityBasis.BOM_DECLARED' | null
}

const CONTRACTS: Readonly<Record<CadQuantityKind, CadQuantityContract>> = {
  drawing_occurrences: {
    quantity_kind: 'drawing_occurrences',
    quantity_basis: 'drawing_occurrence',
    quantity_basis_enum: 'QuantityBasis.DRAWING_OCCURRENCE',
  },
  bom_attribute: {
    quantity_kind: 'bom_attribute',
    quantity_basis: 'bom_declared',
    quantity_basis_enum: 'QuantityBasis.BOM_DECLARED',
  },
  measured_length: {
    quantity_kind: 'measured_length',
    quantity_basis: null,
    quantity_basis_enum: null,
  },
  annotation_occurrences: {
    quantity_kind: 'annotation_occurrences',
    quantity_basis: null,
    quantity_basis_enum: null,
  },
  text_frequency: {
    quantity_kind: 'text_frequency',
    quantity_basis: null,
    quantity_basis_enum: null,
  },
  unknown: {
    quantity_kind: 'unknown',
    quantity_basis: null,
    quantity_basis_enum: null,
  },
}

/**
 * Keeps the legacy CAD tools' quantity labels aligned with cadtasks.QuantityBasis without
 * pretending that text hits, measurements, or technical coverage counters are budget quantities.
 */
export function quantityContract(kind: CadQuantityKind): CadQuantityContract {
  return { ...CONTRACTS[kind] }
}
