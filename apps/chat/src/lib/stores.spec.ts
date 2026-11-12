/// <reference types="jest" />
import { useAuthStore, useChatStore } from './stores';

it('persists the chat store under renovix-chat and the auth store under renovix-auth', () => {
  expect(useChatStore.persist.getOptions().name).toBe('renovix-chat');
  expect(useAuthStore.persist.getOptions().name).toBe('renovix-auth');
});
