/**
 * The drafter may only ever create or touch layers under this prefix.
 *
 * The prefix is the whole isolation story for drawing content: everything the agent adds
 * is on layers the user can select, freeze or delete in one action, and anything the user
 * drew stays on layers the agent is refused access to. It is enforced here rather than in
 * the prompt because a prompt-only rule fails exactly when the model is confused, which is
 * when the user's drawing most needs protecting.
 */
export const DRAFTER_LAYER_PREFIX = 'XL-'

const MAX_LAYER_NAME_LENGTH = 255
// AutoCAD rejects these in symbol names; a DXF carrying them may not reopen at all.
const FORBIDDEN_LAYER_CHARACTERS = /[<>/\\":;?*|,='`]/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u

export function isDrafterLayer(name: string): boolean {
  return name.startsWith(DRAFTER_LAYER_PREFIX)
}

/**
 * Validates a layer the drafter wants to create, returning the exact name to write.
 *
 * The name is not silently repaired: a layer whose name the agent did not choose is a
 * layer the agent will fail to find again, and a mismatch between the cited name and the
 * written one makes the evidence wrong.
 */
export function assertDrafterLayerName(rawName: string): string {
  const name = rawName.trim()
  if (!name) {
    throw new Error('Layer name cannot be empty.')
  }
  if (name.length > MAX_LAYER_NAME_LENGTH) {
    throw new Error(`Layer name exceeds ${MAX_LAYER_NAME_LENGTH} characters.`)
  }
  if (!isDrafterLayer(name)) {
    throw new Error(
      `Layer "${name}" must start with ${DRAFTER_LAYER_PREFIX} so everything this agent adds `
      + 'stays separable from the drawing. Use for example XL-NOTE or XL-DIM.',
    )
  }
  if (name === DRAFTER_LAYER_PREFIX) {
    throw new Error(`Layer name needs something after ${DRAFTER_LAYER_PREFIX}, for example XL-NOTE.`)
  }
  if (CONTROL_CHARACTERS.test(name)) {
    throw new Error('Layer name cannot contain control characters.')
  }
  if (FORBIDDEN_LAYER_CHARACTERS.test(name)) {
    throw new Error('Layer name cannot contain any of < > / \\ " : ; ? * | , = \' or a backtick.')
  }
  return name
}

/**
 * Refuses to let the drafter modify an entity that belongs to the drawing's own layers.
 *
 * Applies to the working copy as much as to the source: the copy is meant to be openable
 * in the user's AutoCAD and diffed against the original, which only holds if every
 * difference is on an XL- layer.
 */
export function assertDrafterOwnsLayer(layerName: string, operation: string): void {
  if (!isDrafterLayer(layerName)) {
    throw new Error(
      `${operation} refused: entity is on layer "${layerName}", which belongs to the drawing. `
      + `This agent may only modify entities on ${DRAFTER_LAYER_PREFIX} layers it created.`,
    )
  }
}
