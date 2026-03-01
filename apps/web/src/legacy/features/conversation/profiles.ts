import { registerConversationProfile, type ConversationProfile } from '../../services';

let registered = false;

const NATIVE_PROFILE: ConversationProfile = {
  mode: 'native',
  methods: {
    listThreads: ['thread/list'],
    listLoadedThreads: ['thread/loaded/list'],
    startThread: ['thread/start'],
    subscribeRoom: ['room/subscribe'],
    unsubscribeRoom: ['room/unsubscribe'],
    claimRoom: ['room/claim'],
    releaseRoom: ['room/release'],
    startTurn: ['turn/start'],
    respondApproval: ['codex/request/respond'],
  },
};

const COMPAT_PROFILE: ConversationProfile = {
  mode: 'compatibility',
  methods: {
    listThreads: ['thread/list'],
    listLoadedThreads: ['thread/loaded/list'],
    startThread: ['thread/start'],
    subscribeRoom: ['room/subscribe'],
    unsubscribeRoom: ['room/unsubscribe'],
    claimRoom: ['room/claim'],
    releaseRoom: ['room/release'],
    startTurn: ['conversation/sendMessage', 'turn/start'],
    respondApproval: ['codex/request/respond'],
  },
};

export function ensureConversationProfilesRegistered(): void {
  if (registered) return;

  registerConversationProfile('codex', NATIVE_PROFILE);
  registerConversationProfile('acp', COMPAT_PROFILE);
  registerConversationProfile('gemini', COMPAT_PROFILE);
  registerConversationProfile('openclaw-gateway', COMPAT_PROFILE);

  registered = true;
}
