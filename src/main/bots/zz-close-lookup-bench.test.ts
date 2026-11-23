import { it } from 'vitest'
import { BotItemsStore } from './bot-items-store'

const HOME = { kind: 'bot' as const, botId: 'b1', chatId: 'home' }
const UNBOUNDED = `SELECT * FROM item_events WHERE id IN (SELECT (SELECT id FROM item_events
  WHERE item_uid = json_extract(named.value, '$.uid') AND kind = 'status'
    AND created_at = json_extract(named.value, '$.closedAt')
    AND json_extract(data, '$.to') IN ('done', 'canceled')
  ORDER BY id DESC LIMIT 1) FROM json_each(?) AS named)`

function time(run: () => void, reps: number): number {
  for (let i = 0; i < 20; i++) run()
  const start = process.hrtime.bigint()
  for (let i = 0; i < reps; i++) run()
  return Number(process.hrtime.bigint() - start) / reps / 1000
}

it('bench', () => {
  const rows: string[] = []
  for (const after of [0, 1_000, 10_000, 100_000]) {
    const store = BotItemsStore.open(':memory:')
    let at = 1_000
    const { uid } = store.add(
      { ownerBotId: 'b1', chatId: 'home', source: { kind: 'home', title: null }, title: 'T', status: 'working', links: [] },
      HOME,
      at++
    )
    const closedAt = at++
    store.close(uid, 'done', undefined, HOME, [{ kind: 'owner' }], closedAt)
    for (let i = 0; i < after; i++) store.comment(uid, 'c', HOME, [], at++)
    const arg = [{ uid, closedAt }]
    const bounded = time(() => store.closes(arg), 200)
    // oxlint-disable-next-line typescript/no-explicit-any
    const db = (store as any).db
    const unbounded = time(() => db.prepare(UNBOUNDED).all(JSON.stringify(arg)), 50)
    rows.push(`events-after-close=${after} bounded=${bounded.toFixed(1)}us unbounded=${unbounded.toFixed(1)}us`)
    store.dispose()
  }
  for (const askers of [false, true]) {
    const store = BotItemsStore.open(':memory:')
    let at = 1_000
    const uids = Array.from({ length: 2_000 }, () =>
      store.add(
        { ownerBotId: 'b1', chatId: 'home', source: { kind: 'home', title: null }, title: 'T', status: 'working', links: [] },
        HOME,
        at++
      ).uid
    )
    const actsFor = askers ? [{ kind: 'person' as const, source: 'slack' as const, userId: 'U1', name: 'Dana', workspaceId: null, role: 'member' as const }] : undefined
    let next = 0
    const close = time(() => store.close(uids[next++]!, 'done', undefined, HOME, actsFor, at++), 1_900)
    rows.push(`close ${askers ? 'with saved askers (head)' : 'without (main shape)'}=${close.toFixed(1)}us`)
    store.dispose()
  }
  console.log('BENCH\n' + rows.join('\n'))
})
