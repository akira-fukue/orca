// An ask of several questions, all on one card: a quick reply, or the box's Enter on the line its
// "Replying to" names, picks the line's answer and sends nothing; Send posts the picks as one
// comment, so the agent wakes once. Picks are held on this device
// (the comment box's draft store, so a reload keeps them) until the host has the comment: one the host
// refused for a newer question stays to recover. Box words with files or skills, or with no line
// named, post at once and take the picks along. What each send answers is kept on its pending entry
// (`intent`), so its lines show as sent and can't be sent twice, whatever its words.
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { useLatestHandler } from '@/lib/use-latest-handler'
import { botRefKey, type BotRef } from '@/lib/bot-hosts'
import type { Bot } from '../../../../../shared/bot-types'
import type {
  BotItem,
  BotItemCommentSkill,
  BotItemEvent
} from '../../../../../shared/bots/bot-items'
import {
  botItemQuestionLine,
  type BotItemQuestionShape
} from '../../../../../shared/bots/bot-item-ask'
import {
  botItemAnswersText,
  botItemAnswerWords,
  botItemNamedAnswers,
  botItemRideAlongText
} from '../../../../../shared/bots/bot-item-answer-lines'
import {
  botItemWaitingAsk,
  botItemWaitingLine,
  type BotItemWaitingLine
} from '../../../../../shared/bots/bot-item-question-answers'
import {
  botItemSentAnswers,
  type BotItemPendingComment,
  type BotItemPendingIntent
} from '../../../../../shared/bots/bot-item-pending-comments'
import { botItemCommentFiles } from '../../../../../shared/bots/bot-item-comment-files'
import { useNativeChatDraft } from '../../native-chat/drafts/use-native-chat-draft'
import {
  readNativeChatComposerDraft,
  subscribeToNativeChatComposerDraft
} from '../../native-chat/drafts/native-chat-composer-draft-store'
import {
  readNativeChatDraftCache,
  writeNativeChatDraftCache
} from '../../native-chat/drafts/native-chat-draft-views'

const NOT_COMPOSING = (): boolean => false
const NO_ASK: BotItemQuestionShape = { body: '', decisions: [] }

export function botItemHeldAnswersScope(bot: BotRef, itemUid: string, askId: string): string {
  return `bot-item-answers:${botRefKey(bot)}:${itemUid}:${askId}`
}

/** The item's comment box draft. */
export function botItemCommentScope(bot: BotRef, itemUid: string): string {
  return `bot-item-comment:${botRefKey(bot)}:${itemUid}`
}

/** An ask's answers held on this device, per question line, stored as the comment they post as. */
export function useBotItemHeldAnswers(
  scopeKey: string,
  shape: BotItemQuestionShape
): { held: (string | null)[]; hold: (answers: readonly (string | null)[]) => void } {
  const { draft, setDraft } = useNativeChatDraft(scopeKey, NOT_COMPOSING)
  const held = useMemo(() => botItemNamedAnswers(shape, draft), [shape, draft])
  const hold = useCallback(
    (answers: readonly (string | null)[]) => setDraft(botItemAnswersText(shape, answers)),
    [setDraft, shape]
  )
  return { held, hold }
}

/** The host has a send (or may: one discarded after it may have arrived): each answer it sent leaves
 *  the ask's held picks, line by line, only where that line still holds exactly what was sent. Lines
 *  picked since, or added to the ask after it was sent, stay as they are. */
export function botItemClearDeliveredAnswers(scopeKey: string, intent: BotItemPendingIntent): void {
  const { shape, answers } = intent
  const sent = new Set(
    answers.flatMap((words, index) =>
      words
        ? [
            botItemAnswersText(
              shape,
              shape.decisions.map((_, at) => (at === index ? words : null))
            )
          ]
        : []
    )
  )
  const lines = readNativeChatDraftCache(scopeKey).split('\n')
  const kept = lines.filter((line) => !sent.has(line.trim()))
  if (kept.length !== lines.length) {
    writeNativeChatDraftCache(scopeKey, kept.join('\n'))
  }
}

export type BotItemQuestionSteps = {
  askId: string
  shape: BotItemQuestionShape
  /** Per line, the answer picked here and not sent yet; only on lines still open to a pick. */
  picks: readonly (string | null)[]
  /** The lines still open to a pick: no comment answered them, and no send of them is on its way. */
  lines: readonly number[]
  /** A quick reply: picks it, swaps it for the line's other pick, or clears it when picked. */
  pick: (index: number, words: string) => void
  /** Editing a line in the comment box takes it over: its pick goes, and the box answers it. */
  bind: (index: number) => void
  /** Send: the picks post as one comment. `empty`: none picked; `none`: no line is open. */
  send: () => 'sent' | 'empty' | 'none'
  /** No line open, and a send of them on its way (not failed): Send reads as sending until the read. */
  sending: boolean
}

export type BotItemQuickReplyActions = {
  send: (text: string) => void
  edit: (text: string) => void
  /** Into the box as a comment of its own, answering no line: answers held for an earlier ask. */
  recover: (text: string) => void
  /** Type your answer: the comment box takes focus, glowing once. */
  type: () => void
  /** The waiting ask of several questions, all its lines at once. */
  steps?: BotItemQuestionSteps | null
  /** Per ask, the answers of its sends on their way, by line. */
  sent?: ReadonlyMap<string, readonly (string | null)[]>
}

export function useBotItemQuestionSteps(
  bot: Bot,
  item: BotItem,
  events: readonly BotItemEvent[],
  /** `questionId`: the ask the text answers, so a reply that lands after a new question is refused;
   *  `plain`: it answers none; `intent`: what it answers, kept on this device. */
  send: (
    text: string,
    paths?: readonly string[],
    questionId?: string,
    plain?: boolean,
    skills?: readonly BotItemCommentSkill[],
    intent?: BotItemPendingIntent
  ) => void,
  pending: readonly BotItemPendingComment[]
): {
  steps: BotItemQuestionSteps | null
  sent: ReadonlyMap<string, readonly (string | null)[]>
  /** A quick reply of one question, posted at once as it always has. */
  quick: (text: string) => void
  /** The comment box's send: it answers only the question its "Replying to" names; with none named
   *  (its × closed), the comment answers nothing. */
  fromBox: (
    text: string,
    paths: readonly string[],
    replyingTo: string | null,
    skills?: readonly BotItemCommentSkill[]
  ) => void
  /** The box's next draft answers no line: recovered answers of an earlier ask, a comment of its own. */
  answerNone: () => void
  /** What the comment box replies to: with several questions, the line its draft was started on. */
  waitingLine: BotItemWaitingLine | null
} {
  // As cheap as the box's own waiting-line read, on each render.
  const asked = botItemWaitingAsk(item, events)
  const waiting = asked && asked.shape.decisions.length > 1 ? asked : null
  const askId = waiting?.askId ?? ''
  const shape = waiting?.shape ?? NO_ASK
  // One question, or one in prose: the box names it until its × closes.
  const oneLine = waiting ? null : botItemWaitingLine(item, events)
  const heldScope = botItemHeldAnswersScope(bot, item.uid, askId)
  const { held, hold } = useBotItemHeldAnswers(heldScope, shape)
  const sent = botItemSentAnswers(pending)
  const sending = (waiting && sent.get(askId)) || null
  // The line the box's draft answers: the line named when its first words arrived (typed, pasted,
  // dictated or restored alike: the box's draft store says), until it is empty again; `none`: no line.
  // `explicit`: a line's own edit or Type your answer named it, so it holds in an empty box too, until
  // a send.
  const [bound, setBound] = useState<
    { askId: string; index: number; explicit: boolean } | 'none' | null
  >(null)
  const boxScope = botItemCommentScope(bot, item.uid)
  const subscribeBox = useCallback(
    (listener: () => void) => subscribeToNativeChatComposerDraft(boxScope, listener),
    [boxScope]
  )
  // Words or an attachment alike start a draft.
  const boxEmpty = useSyncExternalStore(subscribeBox, () => {
    const box = readNativeChatComposerDraft(boxScope)
    return box.text.trim() === '' && box.images.length === 0
  })
  // Open to a pick: no comment answered it (a plain comment read by order gives way to a pick), and
  // no send of it is on its way.
  const lines = shape.decisions.flatMap((_, index) =>
    (!waiting?.answers[index] || (waiting.byOrder[index] && held[index])) && !sending?.[index]
      ? [index]
      : []
  )
  // A line another client answered meanwhile keeps that answer; its pick is dropped.
  const picks = shape.decisions.map((_, at) => (lines.includes(at) ? (held[at] ?? null) : null))
  const eligible = (index: number): boolean => lines.includes(index) && !picks[index]
  // Stored picks: a line a comment answered by name loses its pick; one on its way keeps it, to
  // recover if the host refuses it.
  const stored = (index: number, words: string | null): (string | null)[] =>
    shape.decisions.map((_, at) => {
      if (at === index) {
        return words
      }
      return waiting?.answers[at] && !waiting.byOrder[at] ? null : (held[at] ?? null)
    })
  const post = (
    answers: (string | null)[],
    text: string,
    paths: readonly string[],
    skills?: readonly BotItemCommentSkill[]
  ): void => send(text, paths, askId, undefined, skills, { askId, shape, answers })
  const pick = useLatestHandler((index: number, words: string) => {
    if (lines.includes(index)) {
      hold(stored(index, held[index] === words ? null : words))
    }
  })
  const bind = useLatestHandler((index: number) => {
    setBound({ askId, index, explicit: true })
    if (held[index]) {
      hold(stored(index, null))
    }
  })
  const sendPicks = useLatestHandler((): 'sent' | 'empty' | 'none' => {
    if (picks.some(Boolean)) {
      post(picks, botItemAnswersText(shape, picks), [])
      return 'sent'
    }
    return lines.length > 0 ? 'empty' : 'none'
  })
  const fromBox = useLatestHandler(
    (
      text: string,
      paths: readonly string[],
      replyingTo: string | null,
      skills?: readonly BotItemCommentSkill[]
    ) => {
      setBound(null)
      if (!waiting) {
        const answers = replyingTo !== null && oneLine !== null
        // Answering the one question: what it answers stays with the send.
        const intent =
          answers && asked
            ? {
                askId: asked.askId,
                shape: asked.shape,
                answers: asked.shape.decisions.map((_, index) =>
                  botItemAnswerWords(asked.shape, index, { text })
                )
              }
            : answers
              ? { askId: oneLine.eventId, shape: NO_ASK, answers: [] }
              : undefined
        send(text, paths, undefined, oneLine !== null && replyingTo === null, skills, intent)
        return
      }
      const line = shape.decisions.findIndex((_, index) => replyingTo === `${askId}:${index}`)
      if (line !== -1 && eligible(line)) {
        if (
          paths.length === 0 &&
          (skills?.length ?? 0) === 0 &&
          botItemCommentFiles(text).files.length === 0
        ) {
          // Typed words wait like a pick: the line folds to them, the box names the next open line,
          // and Send posts them with the rest.
          hold(stored(line, text.replace(/\s+/g, ' ').trim()))
          return
        }
        // Files (attached, or named in the words as a file pill) and skills aren't held here: they
        // post now, with the picks so far.
        const next = picks.map((words, at) => (at === line ? text : words))
        post(next, botItemAnswersText(shape, next), paths, skills)
      } else if (picks.some(Boolean)) {
        // The picks name their lines; the words ride along answering none.
        post(picks, botItemRideAlongText(shape, picks, text), paths, skills)
      } else {
        send(text, paths, undefined, true, skills)
      }
    }
  )
  const answerNone = useLatestHandler(() => setBound('none'))
  // Read fresh each render, as the waiting ask is.
  const steps: BotItemQuestionSteps | null = waiting
    ? {
        askId,
        shape,
        picks,
        lines,
        pick,
        bind,
        send: sendPicks,
        sending:
          lines.length === 0 &&
          pending.some(({ failed, intent }) => !failed && intent?.askId === askId)
      }
    : null
  const quick = useLatestHandler((text: string) => {
    const intent = asked
      ? {
          askId: asked.askId,
          shape: asked.shape,
          answers: asked.shape.decisions.map((_, index) =>
            botItemAnswerWords(asked.shape, index, { text })
          )
        }
      : undefined
    send(text, [], asked?.askId, undefined, undefined, intent)
  })
  // The box's draft keeps the line it was started on; once that line can't take it, no other line
  // is named over the same words. An empty box names the first line open and not picked.
  const first = lines.find((index) => !picks[index])
  // The draft's first words take the line named then; an emptied draft lets go of it. A draft already
  // there when the item opens (restored) names no line: which one it was for is not known.
  const [wasEmpty, setWasEmpty] = useState(boxEmpty)
  if (wasEmpty !== boxEmpty) {
    setWasEmpty(boxEmpty)
    if (!boxEmpty && bound === null) {
      setBound(waiting && first !== undefined ? { askId, index: first, explicit: false } : 'none')
    } else if (boxEmpty && (bound === 'none' || (bound && !bound.explicit))) {
      setBound(null)
    }
  }
  const boxLine = (): number | undefined => {
    if (bound === 'none') {
      return undefined
    }
    if (!bound || bound.askId !== askId) {
      return boxEmpty ? first : undefined
    }
    return eligible(bound.index) ? bound.index : boxEmpty ? first : undefined
  }
  const line = waiting ? boxLine() : undefined
  const stepLine = line === undefined ? undefined : shape.decisions[line]
  return {
    steps,
    sent,
    quick,
    fromBox,
    answerNone,
    waitingLine: waiting
      ? stepLine
        ? {
            id: `${askId}:${line}`,
            eventId: askId,
            line: botItemQuestionLine(stepLine.question),
            replies: stepLine.replies.length > 0
          }
        : null
      : // Its answer on its way: the box names it no longer.
        oneLine &&
          !pending.some((entry) => !entry.failed && entry.intent?.askId === oneLine.eventId)
        ? oneLine
        : null
  }
}
