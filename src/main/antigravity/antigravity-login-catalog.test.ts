import { expect, it } from 'vitest'
import { AntigravityAccountService } from './native-account-service'
import {
  reportingCredentialChanges,
  setAntigravityNativeCredentialChangeListener
} from './native-account-host'
import { forgetPreviousAgyLoginCatalog } from './antigravity-login-catalog'
import { credential, harness } from './native-account-test-fixtures'
import { parseAgyModelListing } from './antigravity-model-listing'
import { agentModelCatalogStore as store } from '../native-chat/agent-model-catalog/agent-model-catalog-store'

function agy(target: { runtime: 'host' | 'wsl'; wslDistro: string | null }) {
  const native = harness(credential('a'))
  const reporting = reportingCredentialChanges(native.backend, target)
  const service = new AntigravityAccountService(
    native.store,
    reporting,
    Date.now,
    native.lookupIdentity
  )
  return { ...native, service }
}
const saveCatalog = () =>
  store.recordSuccess(
    'agy-home',
    'antigravity',
    { models: parseAgyModelListing('gemini-4-neon-high\tGemini 4 Neon (high)'), origin: 'probe' },
    'discovery'
  )
const saved = () => store.get('agy-home') !== null

it("agy signing in to another host account drops the catalog; the same account or a WSL distro's keeps it", async () => {
  setAntigravityNativeCredentialChangeListener(forgetPreviousAgyLoginCatalog)
  const host = agy({ runtime: 'host', wslDistro: null })
  await host.service.addCurrentAccount()
  host.setNative(credential('b'))
  const { accounts } = await host.service.addCurrentAccount()
  const b = accounts.find((row) => row.subject === 'b')!.id
  saveCatalog()
  const revision = store.retirementRevision('antigravity')

  await host.service.selectAccount(b)
  host.setNative(credential('b', 2))
  await host.service.listAccounts()
  const wsl = agy({ runtime: 'wsl', wslDistro: 'Ubuntu' })
  await wsl.service.listAccounts()
  wsl.setNative(credential('b'))
  await wsl.service.listAccounts()
  expect(saved()).toBe(true)
  expect(store.retirementRevision('antigravity')).toBe(revision)

  // Outside Orca.
  host.setNative(credential('a'))
  await host.service.listAccounts()
  expect(saved()).toBe(false)
  saveCatalog()
  await host.service.selectAccount(b)
  expect(saved()).toBe(false)
})
