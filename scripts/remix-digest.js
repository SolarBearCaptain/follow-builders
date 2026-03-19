#!/usr/bin/env node

// ============================================================================
// Follow Builders — Remix Digest via AI API
// ============================================================================
// Takes the JSON output from prepare-digest.js and calls an AI API to
// remix it into a human-readable digest, then outputs the text to stdout.
//
// Supports: OpenAI, Anthropic
//
// Usage:
//   node prepare-digest.js | node remix-digest.js
//   node remix-digest.js --file /path/to/prepared.json
//
// Environment variables:
//   OPENAI_API_KEY    — for OpenAI (default)
//   ANTHROPIC_API_KEY — for Anthropic (used if OPENAI_API_KEY not set)
// ============================================================================

import { readFile } from 'fs/promises';

// -- Read input --------------------------------------------------------------

async function getInput() {
  const args = process.argv.slice(2);

  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return await readFile(args[fileIdx + 1], 'utf-8');
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// -- Build prompt ------------------------------------------------------------

function buildPrompt(data) {
  const lang = data.config?.language || 'en';
  const langInstruction = {
    en: 'Write the entire digest in English.',
    zh: 'Write the entire digest in Chinese (Mandarin, simplified). Keep technical terms (AI, LLM, GPU, API, agent, etc.) and proper nouns in English. The tone should be professional but conversational.',
    bilingual: 'Interleave English and Chinese paragraph by paragraph. After each builder summary in English, place the Chinese translation directly below, then move to the next builder. Same for podcasts.'
  }[lang] || 'Write the entire digest in English.';

  // Trim transcripts to avoid token limits
  const podcasts = (data.podcasts || []).map(p => ({
    ...p,
    transcript: p.transcript ? p.transcript.slice(0, 15000) : ''
  }));

  const contentJson = JSON.stringify({
    x: data.x || [],
    podcasts,
    stats: data.stats
  });

  return `You are an AI content curator producing a digest of what top AI builders are saying.

## Prompts to follow

### Digest structure
${data.prompts?.digest_intro || 'Organize by X/Twitter section first, then Podcasts.'}

### Tweet summarization
${data.prompts?.summarize_tweets || 'Summarize each builder\'s tweets in 2-4 sentences.'}

### Podcast summarization
${data.prompts?.summarize_podcast || 'Summarize podcast in 200-400 words with a key takeaway.'}

### Translation
${data.prompts?.translate || 'Translate naturally to Chinese if needed.'}

## Language setting
${langInstruction}

## Content (from feeds — do NOT fabricate anything)
${contentJson}

## Rules
- NEVER invent content. Only use what is provided above.
- Every piece of content MUST include its URL.
- Use the bio field for job titles. Do NOT guess.
- Skip builders with no substantive tweets.
- Do NOT use @ handles in the output.
- End with: "回复即可调整你的推送设置或摘要风格。"

Generate the digest now.`;
}

// -- Call OpenAI -------------------------------------------------------------

async function callOpenAI(prompt, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 4096
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const result = await res.json();
  return result.choices[0].message.content;
}

// -- Call Anthropic ----------------------------------------------------------

async function callAnthropic(prompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const result = await res.json();
  return result.content[0].text;
}

// -- Main --------------------------------------------------------------------

async function main() {
  const input = await getInput();
  const data = JSON.parse(input);

  if (data.stats?.podcastEpisodes === 0 && data.stats?.xBuilders === 0) {
    console.log('No new updates from your builders today. Check back tomorrow!');
    return;
  }

  const prompt = buildPrompt(data);

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  let digest;
  if (openaiKey) {
    digest = await callOpenAI(prompt, openaiKey);
  } else if (anthropicKey) {
    digest = await callAnthropic(prompt, anthropicKey);
  } else {
    throw new Error('No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  console.log(digest);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
