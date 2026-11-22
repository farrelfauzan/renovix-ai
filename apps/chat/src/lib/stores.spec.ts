/// <reference types="jest" />
import { useAuthStore, useChatStore } from './stores';

it('persists the chat store under renovix-chat and the auth store under renovix-auth', () => {
  expect(useChatStore.persist.getOptions().name).toBe('renovix-chat');
  expect(useAuthStore.persist.getOptions().name).toBe('renovix-auth');
});

describe('RNX-334: the auth store keeps only an http(s) URL as the avatar', () => {
  it.each([
    ['https://lh3.googleusercontent.example.test/a/picture', 'https://lh3.googleusercontent.example.test/a/picture'],
    ['http://avatars.example.test/u/1', 'http://avatars.example.test/u/1'],
    ['users/u1/profile-photo/p.png', null],
    ['javascript:alert(1)', null],
    [null, null],
  ])('setSessionAuth(%p) leaves avatar %p', (inputImage, expectedAvatar) => {
    useAuthStore.getState().setSessionAuth('dewi@example.test', 'Dewi', inputImage);

    expect(useAuthStore.getState().avatar).toBe(expectedAvatar);
    useAuthStore.getState().logout();
  });
});
