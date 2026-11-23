import { agentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import type { AntigravityNativeCredentialChange } from './native-account-host'

/** agy on this machine signed in to another account, through Orca or not: its saved Antigravity
 *  catalogs are the previous account's (#46905). Chats never run in WSL, so a distro's login
 *  owns none, and a same-account sign-in keeps them. */
export function forgetPreviousAgyLoginCatalog(change: AntigravityNativeCredentialChange): void {
  if (change.otherLogin && change.target.runtime === 'host') {
    agentModelCatalogStore.expireAgent('antigravity', true)
  }
}
