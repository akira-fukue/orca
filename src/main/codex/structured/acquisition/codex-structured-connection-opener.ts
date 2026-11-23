import {
  spawnCodexAppServerConnection,
  spawnRelayedCodexAppServerConnection
} from '../../app-server/codex-app-server-connection'
import { sharedCodexServerPool } from '../../app-server/shared-servers/codex-shared-server-pool'
import { codexSkillRoots } from '../launch/codex-structured-skill-roots'
import type {
  CodexStructuredLaunch,
  CodexStructuredSessionAdapterDeps
} from '../session-lifecycle/codex-structured-session-state'

type CodexConnectionOpen = NonNullable<CodexStructuredSessionAdapterDeps['openConnection']>

const sharedOpeners = new WeakSet<CodexConnectionOpen>()

/** A shared server is many chats' process, so no one chat's recovery may ever signal it. */
export function opensSharedCodexServer(open: CodexConnectionOpen): boolean {
  return sharedOpeners.has(open)
}

/** Off or a custom Codex command: the chat has its own app-server (relayed on macOS and Linux).
 *  Windows: its own, launched by this app as always. On: it leases a thread on a shared one. */
export function codexConnectionOpener(
  deps: Pick<CodexStructuredSessionAdapterDeps, 'openConnection' | 'sharedServers'>,
  sessionId: string,
  launch: Pick<
    CodexStructuredLaunch,
    'visuals' | 'linkedSkillsRoot' | 'codexVersion' | 'customCommand' | 'appBoundGrants'
  >,
  platform: NodeJS.Platform = process.platform
): CodexConnectionOpen {
  if (deps.openConnection) {
    return deps.openConnection
  }
  // Windows can't read a process's environment, so a shared chat's Stop could never be proven
  // there; every Windows chat keeps its own server.
  // A bot's chat holds grants that end with this app, so it keeps today's launch for now.
  if (platform === 'win32' || launch.appBoundGrants) {
    return spawnCodexAppServerConnection
  }
  // A chat's own app-server runs under the terminal daemon where it can, so it survives a restart.
  if (launch.customCommand || deps.sharedServers?.() !== true) {
    return spawnRelayedCodexAppServerConnection(sessionId)
  }
  const skillRoots = codexSkillRoots({
    ...(launch.visuals ? { visualsSkillsRoot: launch.visuals.skill.skillsRoot } : {}),
    ...(launch.linkedSkillsRoot ? { linkedSkillsRoot: launch.linkedSkillsRoot } : {})
  })
  const open: CodexConnectionOpen = (connectionLaunch, handlers) =>
    sharedCodexServerPool().open(connectionLaunch, handlers ?? {}, {
      sessionId,
      skillRoots,
      codexVersion: launch.codexVersion ?? null
    })
  sharedOpeners.add(open)
  return open
}
