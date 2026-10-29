import { describe, expect, it } from 'vitest';
import { cleanSendRequest, sendRequestFor } from './message.js';

describe('cleanSendRequest', () => {
  it('accepts a reply and a new message, trimmed', () => {
    expect(cleanSendRequest({ kind: 'reply', conversationId: 12, body: '  hi  ' })).toEqual({ kind: 'reply', conversationId: 12, body: 'hi' });
    expect(cleanSendRequest({ kind: 'new', recipients: [5, 5, 6], subject: ' Q ', body: 'Hello', contextCode: 'course_9' })).toEqual({ kind: 'new', recipients: [5, 6], subject: 'Q', body: 'Hello', contextCode: 'course_9' });
  });

  it('refuses anything else', () => {
    expect(cleanSendRequest({ kind: 'reply', conversationId: 12, body: '   ' })).toBeNull();
    expect(cleanSendRequest({ kind: 'reply', conversationId: '12', body: 'x' })).toBeNull();
    expect(cleanSendRequest({ kind: 'reply', conversationId: 12, body: 'x'.repeat(20001) })).toBeNull();
    expect(cleanSendRequest({ kind: 'new', recipients: [], body: 'x' })).toBeNull();
    expect(cleanSendRequest({ kind: 'new', recipients: ['1'], body: 'x' })).toBeNull();
    expect(cleanSendRequest({ kind: 'delete', conversationId: 1, body: 'x' })).toBeNull();
    expect(cleanSendRequest({ kind: 'new', recipients: [1], body: 'x', contextCode: 'user_1' })).toEqual({ kind: 'new', recipients: [1], subject: '', body: 'x' });
  });
});

describe('sendRequestFor', () => {
  it('maps to Canvas\'s own message endpoints only', () => {
    expect(sendRequestFor({ kind: 'reply', conversationId: 3, body: 'b' })).toEqual({ path: '/api/v1/conversations/3/add_message', payload: { body: 'b' } });
    expect(sendRequestFor({ kind: 'new', recipients: [7], subject: 's', body: 'b', contextCode: 'course_1' }).payload).toEqual({ recipients: ['7'], subject: 's', body: 'b', group_conversation: true, context_code: 'course_1' });
  });
});

describe('cleanSendRequest: attachments', () => {
  it('keeps up to 10 well-formed files within 25 MB, and refuses the rest', () => {
    const f = (name, data = 'aGk=') => ({ name, type: 'text/plain', data });
    expect(cleanSendRequest({ kind: 'reply', conversationId: 1, body: 'x', files: [f(' a.txt ')] })).toEqual({ kind: 'reply', conversationId: 1, body: 'x', files: [{ name: 'a.txt', type: 'text/plain', data: 'aGk=' }] });
    expect(cleanSendRequest({ kind: 'reply', conversationId: 1, body: 'x', files: Array.from({ length: 11 }, (_, i) => f(`${i}.txt`)) })).toBeNull();
    expect(cleanSendRequest({ kind: 'reply', conversationId: 1, body: 'x', files: [f('a.txt', 'not base64!')] })).toBeNull();
    expect(cleanSendRequest({ kind: 'reply', conversationId: 1, body: 'x', files: [f('big.bin', 'A'.repeat(36 * 1024 * 1024))] })).toBeNull();
    expect(cleanSendRequest({ kind: 'reply', conversationId: 1, body: 'x', files: 'nope' })).toBeNull();
  });
});
