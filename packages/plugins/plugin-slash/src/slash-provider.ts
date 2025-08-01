import type {
  ComputePositionConfig,
  Middleware,
  OffsetOptions,
  VirtualElement,
} from '@floating-ui/dom'
import type { Node } from '@milkdown/prose/model'
import type { EditorState } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

import { computePosition, flip, offset } from '@floating-ui/dom'
import { findParentNode, posToDOMRect } from '@milkdown/prose'
import { TextSelection } from '@milkdown/prose/state'
import { debounce } from 'lodash-es'

/// Options for slash provider.
export interface SlashProviderOptions {
  /// The slash content.
  content: HTMLElement
  /// The debounce time for updating slash, 200ms by default.
  debounce?: number
  /// The function to determine whether the tooltip should be shown.
  shouldShow?: (view: EditorView, prevState?: EditorState) => boolean
  /// The key trigger for shouldShow, '/' by default.
  trigger?: string | string[]
  /// The offset to get the block. Default is 0.
  offset?: OffsetOptions
  /// Other middlewares for floating ui. This will be added after the internal middlewares.
  middleware?: Middleware[]
  /// Options for floating ui. If you pass `middleware` or `placement`, it will override the internal settings.
  floatingUIOptions?: Partial<ComputePositionConfig>
  /// The root element that the slash will be appended to.
  root?: HTMLElement
}

/// A provider for creating slash.
export class SlashProvider {
  /// The root element of the slash.
  element: HTMLElement

  /// @internal
  #initialized = false

  /// @internal
  readonly #middleware: Middleware[]

  /// @internal
  readonly #floatingUIOptions: Partial<ComputePositionConfig>

  /// @internal
  readonly #root?: HTMLElement

  /// @internal
  readonly #debounce: number

  /// @internal
  readonly #trigger: string | string[]

  /// @internal
  readonly #shouldShow: (view: EditorView, prevState?: EditorState) => boolean

  /// @internal
  readonly #updater: {
    (view: EditorView, prevState?: EditorState): void
    cancel: () => void
  }

  /// The offset to get the block. Default is 0.
  readonly #offset?: OffsetOptions

  /// On show callback.
  onShow = () => {}

  /// On hide callback.
  onHide = () => {}

  constructor(options: SlashProviderOptions) {
    this.element = options.content
    this.#debounce = options.debounce ?? 200
    this.#shouldShow = options.shouldShow ?? this.#_shouldShow
    this.#trigger = options.trigger ?? '/'
    this.#offset = options.offset
    this.#middleware = options.middleware ?? []
    this.#floatingUIOptions = options.floatingUIOptions ?? {}
    this.#root = options.root
    this.#updater = debounce(this.#onUpdate, this.#debounce)
  }

  /// @internal
  #onUpdate = (view: EditorView, prevState?: EditorState): void => {
    const { state, composing } = view
    const { selection, doc } = state
    const { ranges } = selection
    const from = Math.min(...ranges.map((range) => range.$from.pos))
    const to = Math.max(...ranges.map((range) => range.$to.pos))
    const isSame =
      prevState && prevState.doc.eq(doc) && prevState.selection.eq(selection)

    if (!this.#initialized) {
      const root = this.#root ?? view.dom.parentElement ?? document.body
      root.appendChild(this.element)
      this.#initialized = true
    }

    if (composing || isSame) return

    if (!this.#shouldShow(view, prevState)) {
      this.hide()
      return
    }

    const virtualEl: VirtualElement = {
      getBoundingClientRect: () => posToDOMRect(view, from, to),
    }
    computePosition(virtualEl, this.element, {
      placement: 'bottom-start',
      middleware: [flip(), offset(this.#offset), ...this.#middleware],
      ...this.#floatingUIOptions,
    })
      .then(({ x, y }) => {
        Object.assign(this.element.style, {
          left: `${x}px`,
          top: `${y}px`,
        })
      })
      .catch(console.error)

    this.show()
  }

  /// @internal
  #_shouldShow(view: EditorView): boolean {
    const currentTextBlockContent = this.getContent(view)

    if (!currentTextBlockContent) return false

    const target = currentTextBlockContent.at(-1)

    if (!target) return false

    return Array.isArray(this.#trigger)
      ? this.#trigger.includes(target)
      : this.#trigger === target
  }

  /// Update provider state by editor view.
  update = (view: EditorView, prevState?: EditorState): void => {
    this.#updater(view, prevState)
  }

  /// Get the content of the current text block.
  /// Pass the `matchNode` function to determine whether the current node should be matched, by default, it will match the paragraph node.
  getContent = (
    view: EditorView,
    matchNode: (node: Node) => boolean = (node) =>
      node.type.name === 'paragraph'
  ): string | undefined => {
    const { selection } = view.state
    const { empty, $from } = selection
    const isTextBlock = view.state.selection instanceof TextSelection

    if (typeof document === 'undefined') return

    const isSlashChildren = this.element.contains(document.activeElement)

    const notHasFocus = !view.hasFocus() && !isSlashChildren

    const isReadonly = !view.editable

    const paragraph = findParentNode(matchNode)(view.state.selection)

    const isNotInParagraph = !paragraph

    if (notHasFocus || isReadonly || !empty || !isTextBlock || isNotInParagraph)
      return

    return $from.parent.textBetween(
      Math.max(0, $from.parentOffset - 500),
      $from.parentOffset,
      undefined,
      '\uFFFC'
    )
  }

  /// Destroy the slash.
  destroy = () => {
    this.#updater.cancel()
  }

  /// Show the slash.
  show = () => {
    this.element.dataset.show = 'true'
    this.onShow()
  }

  /// Hide the slash.
  hide = () => {
    this.element.dataset.show = 'false'
    this.onHide()
  }
}
