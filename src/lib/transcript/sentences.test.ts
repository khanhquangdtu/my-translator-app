/**
 * The two failure modes this splitter sits between.
 *
 * Break too rarely and the reader gets the wall of text the module was written
 * to remove; break too eagerly and a false full stop — a decimal, an initial,
 * "Dr." — cuts a sentence in half, which is worse than not breaking at all
 * because it reads as a finished thought that isn't one. Both are easy to
 * reintroduce while tuning the other, so both are pinned here.
 *
 * The exactness of the slices matters too: nothing here may lose or invent a
 * character, since these strings go straight to the screen.
 */
import { describe, expect, it } from 'vitest';

import { splitSentences } from './sentences';

describe('splitSentences', () => {
  it('gives each sentence its own line', () => {
    expect(
      splitSentences(
        'Chúng ta sẽ bắt đầu cuộc họp lúc chín giờ sáng. Mọi người nhớ mang theo tài liệu đã gửi hôm qua. Cảm ơn tất cả các bạn rất nhiều.'
      )
    ).toEqual([
      'Chúng ta sẽ bắt đầu cuộc họp lúc chín giờ sáng.',
      'Mọi người nhớ mang theo tài liệu đã gửi hôm qua.',
      'Cảm ơn tất cả các bạn rất nhiều.',
    ]);
  });

  it('leaves a single sentence alone', () => {
    const one = 'I think we should wait for the other team before we decide.';
    expect(splitSentences(one)).toEqual([one]);
  });

  it('keeps every short sentence on its own line', () => {
    expect(splitSentences('Yes. No. Maybe. I really am not sure about that one.')).toEqual([
      'Yes.', 'No.', 'Maybe.', 'I really am not sure about that one.',
    ]);
  });

  it('separates a short opener from the sentence that follows it', () => {
    expect(
      splitSentences('Right. The invoice was sent to the wrong address last Tuesday.')
    ).toEqual(['Right.', 'The invoice was sent to the wrong address last Tuesday.']);
  });

  it('separates a short closer from the sentence before it', () => {
    expect(
      splitSentences('The invoice was sent to the wrong address last Tuesday. Thanks.')
    ).toEqual(['The invoice was sent to the wrong address last Tuesday.', 'Thanks.']);
  });

  it('does not break a decimal or a domain', () => {
    const text = 'The rate came out at 3.5 percent on example.com, which nobody expected at all.';
    expect(splitSentences(text)).toEqual([text]);
  });

  it('distinguishes a short answer from a numbered item', () => {
    expect(splitSentences('No. Thanks.')).toEqual(['No.', 'Thanks.']);
    expect(splitSentences('Please use invoice No. 5 for this order.'))
      .toEqual(['Please use invoice No. 5 for this order.']);
  });

  it('does not break after an abbreviation', () => {
    const text = 'Dr. Nguyen said the second batch was already approved by the committee.';
    expect(splitSentences(text)).toEqual([text]);
  });

  it('does not break between initials', () => {
    const text = 'J. K. Rowling was mentioned twice during the interview this afternoon.';
    expect(splitSentences(text)).toEqual([text]);
  });

  it('does not break before a lower-case continuation', () => {
    const text = 'We waited until 6 p.m. before anybody decided to call the supplier back.';
    expect(splitSentences(text)).toEqual([text]);
  });

  it('breaks after a question mark and keeps the closing quote with it', () => {
    expect(
      splitSentences(
        'He asked "are we still meeting tomorrow?" Nobody in the room answered him.'
      )
    ).toEqual([
      'He asked "are we still meeting tomorrow?"',
      'Nobody in the room answered him.',
    ]);
  });

  it('treats a run of terminators as one ending', () => {
    expect(
      splitSentences('Are you seriously asking me that?! We agreed on this last week already.')
    ).toEqual(['Are you seriously asking me that?!', 'We agreed on this last week already.']);
  });

  it('breaks at a full-width stop without needing a space after it', () => {
    expect(splitSentences('我们明天早上九点开会，请准时到达会议室。带上昨天发的那份文件，谢谢大家的配合。')).toEqual([
      '我们明天早上九点开会，请准时到达会议室。',
      '带上昨天发的那份文件，谢谢大家的配合。',
    ]);
  });

  it('does not split a single long sentence at a comma', () => {
    const text =
      'so then we went over to the other building because the meeting room there was free, and we sat down with the finance people to go through the numbers one more time, but nobody could find the original spreadsheet anywhere';
    expect(splitSentences(text)).toEqual([text]);
  });

  it('separates short Vietnamese sentences', () => {
    expect(splitSentences('Xin chào. Tôi là Nam. Bạn khỏe không? Cảm ơn!')).toEqual([
      'Xin chào.', 'Tôi là Nam.', 'Bạn khỏe không?', 'Cảm ơn!',
    ]);
  });

  it('separates short CJK sentences without spaces', () => {
    expect(splitSentences('你好。谢谢！再见。')).toEqual(['你好。', '谢谢！', '再见。']);
  });

  it('preserves explicit line breaks without punctuation', () => {
    expect(splitSentences('  Xin chào\r\n\nTôi là Nam\nCảm ơn  ')).toEqual([
      'Xin chào', 'Tôi là Nam', 'Cảm ơn',
    ]);
  });

  it('never loses or invents a character', () => {
    const text =
      'Xin chào. Tôi tên là Nam, rất vui được gặp bạn hôm nay. Chúng ta bắt đầu nhé?';
    expect(splitSentences(text).join(' ')).toBe(text);
  });

  it('has nothing to draw for empty text', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('returns the same array for the same text', () => {
    const text = 'The cache is what keeps this off the audio thread. It runs on every token.';
    expect(splitSentences(text)).toBe(splitSentences(text));
  });
});
