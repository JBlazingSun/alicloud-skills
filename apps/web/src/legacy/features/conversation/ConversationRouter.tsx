import { useCallback, useEffect, useState } from 'react';
import LegacyChatApp from '../chat/LegacyChatApp';
import { conversationTypeFromSearch, type ConversationType, withConversationTypeInUrl } from './types';

export default function ConversationRouter() {
  const [conversationType, setConversationType] = useState<ConversationType>(() => {
    if (typeof window === 'undefined') return 'codex';
    return conversationTypeFromSearch(window.location.search);
  });
  const handleConversationTypeChange = useCallback((nextType: ConversationType) => {
    if (typeof window !== 'undefined') {
      const url = withConversationTypeInUrl(new URL(window.location.href), nextType);
      window.history.pushState({}, '', url);
      window.dispatchEvent(new Event('agent-type-change'));
    }
    setConversationType(nextType);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromLocation = () => {
      setConversationType(conversationTypeFromSearch(window.location.search));
    };
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('agent-type-change', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('agent-type-change', syncFromLocation);
    };
  }, []);

  return (
    <LegacyChatApp
      conversationType={conversationType}
      onConversationTypeChange={handleConversationTypeChange}
    />
  );
}
