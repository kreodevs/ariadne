import { describe, expect, it } from 'vitest';
import { hasExplicitChatScopeNarrowing } from './chat-scope.util';

describe('hasExplicitChatScopeNarrowing', () => {
  it('false sin acotación útil', () => {
    expect(hasExplicitChatScopeNarrowing(undefined)).toBe(false);
    expect(hasExplicitChatScopeNarrowing({})).toBe(false);
    expect(hasExplicitChatScopeNarrowing({ repoIds: [] })).toBe(false);
  });

  it('true con cualquier dimensión no vacía', () => {
    expect(hasExplicitChatScopeNarrowing({ repoIds: ['a'] })).toBe(true);
    expect(hasExplicitChatScopeNarrowing({ includePathPrefixes: ['/src'] })).toBe(true);
    expect(hasExplicitChatScopeNarrowing({ excludePathGlobs: ['**/node_modules/**'] })).toBe(true);
  });
});
