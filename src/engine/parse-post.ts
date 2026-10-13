export type ParsedPost = { body: string; hashtags: string[] };

// Protect complete URLs; accept English, Chinese and paired closing-hash tags.
export function parseEnglishPost(input: string): ParsedPost {
  const tags: string[] = [];
  const seen = new Set<string>();
  let previousTagEnd = -1;
  const raw = input.replace(/\r\n/g, '\n').trim();
  // A hash followed by another tag's letters opens that tag; it must not be
  // swallowed as a closing wrapper. Still accept legacy #tag##tag# input.
  // A complete URL after a legacy closing hash takes precedence over a tag.
  // Include an optional literal prefix hash so #https:// never loses its scheme.
  const body = raw.replace(/[#＃]?https?:\/\/\S+|[#＃]([\p{L}\p{M}\p{N}_＿]+)(?:[#＃](?=https?:\/\/|[^\p{L}\p{M}\p{N}_＿]|$))?/giu,
    (match: string, tag: string | undefined, offset: number) => {
      if (!tag || (offset > 0 && offset !== previousTagEnd && /[\p{L}\p{N}_＿/]/u.test(raw[offset - 1]!))) return match;
      if (!/\p{L}/u.test(tag)) return match;
      previousTagEnd = offset + match.length;
      const key = tag.normalize('NFKC').toLowerCase();
      if (!seen.has(key)) { seen.add(key); tags.push(tag); }
      return '';
    }).split('\n').map((line) => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, hashtags: tags };
}

export function formatBilibiliCaption(description: string, tags: string[]): string {
  const hashLine = tags.map((tag) => `#${tag}`).join(' ');
  return [description, hashLine].filter(Boolean).join('\n\n');
}
