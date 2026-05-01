import { describe, expect, it } from 'vitest';
import { ImportError, parseConversationsFile } from './importExamples';

describe('parseConversationsFile — JSON ShareGPT', () => {
  it('parses a single ShareGPT conversation', () => {
    const text = JSON.stringify({
      conversations: [
        { from: 'human', value: 'hi' },
        { from: 'gpt', value: 'hello' },
      ],
    });
    const result = parseConversationsFile('a.json', text);
    expect(result.format).toBe('sharegpt');
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0]!.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('parses an array of ShareGPT conversations', () => {
    const text = JSON.stringify([
      { conversations: [{ from: 'human', value: 'a' }, { from: 'gpt', value: 'b' }] },
      { conversations: [{ from: 'human', value: 'c' }, { from: 'gpt', value: 'd' }] },
    ]);
    const result = parseConversationsFile('multi.json', text);
    expect(result.examples).toHaveLength(2);
    expect(result.examples[1]!.messages[1]).toEqual({ role: 'assistant', content: 'd' });
  });

  it('parses raw turns as a single ShareGPT conversation', () => {
    const text = JSON.stringify([
      { from: 'system', value: 'be nice' },
      { from: 'human', value: 'hi' },
      { from: 'gpt', value: 'hello' },
    ]);
    const result = parseConversationsFile('turns.json', text);
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0]!.messages[0]!.role).toBe('system');
  });
});

describe('parseConversationsFile — JSON ChatML', () => {
  it('parses a single ChatML conversation', () => {
    const text = JSON.stringify({
      messages: [
        { role: 'user', content: 'What is 1+1?' },
        { role: 'assistant', content: "It's 2!" },
      ],
    });
    const result = parseConversationsFile('a.json', text);
    expect(result.format).toBe('chatml');
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0]!.messages).toEqual([
      { role: 'user', content: 'What is 1+1?' },
      { role: 'assistant', content: "It's 2!" },
    ]);
  });

  it('parses ChatML with multi-part text content', () => {
    const text = JSON.stringify({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'text', text: 'there' }] },
      ],
    });
    const result = parseConversationsFile('multipart.json', text);
    expect(result.examples[0]!.messages[0]!.content).toBe('hi\nthere');
  });

  it('parses an array of ChatML conversations under `data`', () => {
    const text = JSON.stringify({
      data: [
        { messages: [{ role: 'user', content: 'hi' }] },
        { messages: [{ role: 'user', content: 'bye' }] },
      ],
    });
    const result = parseConversationsFile('wrapped.json', text);
    expect(result.examples).toHaveLength(2);
  });
});

describe('parseConversationsFile — JSONL', () => {
  it('parses one conversation per line', () => {
    const text = [
      JSON.stringify({ messages: [{ role: 'user', content: 'a' }] }),
      JSON.stringify({ conversations: [{ from: 'human', value: 'b' }] }),
    ].join('\n');
    const result = parseConversationsFile('a.jsonl', text);
    expect(result.examples).toHaveLength(2);
    expect(result.examples[0]!.messages[0]!.content).toBe('a');
    expect(result.examples[1]!.messages[0]!.content).toBe('b');
  });
});

describe('parseConversationsFile — CSV', () => {
  it('parses a simple two-column CSV as one conversation', () => {
    const text = ['role,content', 'user,hi', 'assistant,hello'].join('\n');
    const result = parseConversationsFile('a.csv', text);
    expect(result.format).toBe('csv');
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0]!.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('groups rows by conversation_id when present', () => {
    const text = [
      'conversation_id,role,content',
      '1,user,a',
      '1,assistant,b',
      '2,user,c',
      '2,assistant,d',
    ].join('\n');
    const result = parseConversationsFile('a.csv', text);
    expect(result.examples).toHaveLength(2);
    expect(result.examples[1]!.messages[1]).toEqual({ role: 'assistant', content: 'd' });
  });

  it('honors quoted fields with commas and newlines', () => {
    const text = [
      'role,content',
      '"user","hello, world\nsecond line"',
      '"assistant","hi"',
    ].join('\n');
    const result = parseConversationsFile('a.csv', text);
    expect(result.examples[0]!.messages[0]!.content).toBe('hello, world\nsecond line');
  });

  it('accepts ShareGPT-style from/value column names', () => {
    const text = ['from,value', 'human,hi', 'gpt,hello'].join('\n');
    const result = parseConversationsFile('a.csv', text);
    expect(result.examples[0]!.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('throws when required columns are missing', () => {
    const text = ['foo,bar', '1,2'].join('\n');
    expect(() => parseConversationsFile('a.csv', text)).toThrow(ImportError);
  });
});

describe('parseConversationsFile — TXT', () => {
  it('parses role-prefixed lines into one conversation', () => {
    const text = ['User: hi', 'Assistant: hello'].join('\n');
    const result = parseConversationsFile('a.txt', text);
    expect(result.format).toBe('txt');
    expect(result.examples[0]!.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('splits conversations on blank lines or --- separators', () => {
    const text = [
      'User: a',
      'Assistant: b',
      '',
      'User: c',
      'Assistant: d',
      '---',
      'User: e',
    ].join('\n');
    const result = parseConversationsFile('a.txt', text);
    expect(result.examples).toHaveLength(3);
  });

  it('appends continuation lines to the previous turn', () => {
    const text = ['User: hi', 'continued', 'Assistant: hello'].join('\n');
    const result = parseConversationsFile('a.txt', text);
    expect(result.examples[0]!.messages[0]!.content).toBe('hi\ncontinued');
  });

  it('treats unprefixed leading text as a user message', () => {
    const result = parseConversationsFile('a.txt', 'just a question');
    expect(result.examples[0]!.messages).toEqual([
      { role: 'user', content: 'just a question' },
    ]);
  });
});

describe('parseConversationsFile — errors', () => {
  it('throws ImportError on invalid JSON', () => {
    expect(() => parseConversationsFile('a.json', '{not json')).toThrow(ImportError);
  });

  it('throws ImportError on unrecognised JSON shape', () => {
    expect(() =>
      parseConversationsFile('a.json', JSON.stringify({ foo: 'bar' })),
    ).toThrow(ImportError);
  });
});
