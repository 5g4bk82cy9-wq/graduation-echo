import { kv } from '@vercel/kv';

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';

async function callDeepSeek(messages, temperature = 0.7) {
  const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature,
      max_tokens: 300
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`DeepSeek API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

function generateCertificate(memory, sentence) {
  const templates = [
    `你的故事，是这世上独一份的篇章。没有人走过完全相同的路，没有人的青春和你重叠成一样的形状。这段关于「${sentence}」的记忆，只属于你。`,
    `在这片回忆的星空里，你是唯一的那颗。不是孤独，而是独特——你的大学四年，用自己的方式发光，不需要任何人的映照。`,
    `相似的经历很多，但感受从不雷同。你的回忆选择了一条只属于自己的路径，而这条路，恰好让你成为了不可替代的风景。`
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function generateGroupFallback(memories) {
  const excerpts = memories.map(m => `"${m.sentence}"`).join('、');
  return `从不同人的故事里，我们看到了相似的青春模样。${excerpts}——这些看似不同的自画像，都藏着同一种热烈和眷恋。`;
}

function generateOneOnOneFallback(otherMemory) {
  return `在无数种可能中，有人和你有相似的注脚。${otherMemory.sentence} —— 同一段青春，不同的坐标，但你们都曾在相似的时刻，感受过相同的心跳。`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const { keywords, memory, sentence, identity } = req.body;

  if (!keywords || !keywords.length) {
    return res.status(400).json({ error: '缺少共鸣关键词' });
  }

  try {
    const key = `keyword:${keyword}`;
    let entries = [];
    let totalCount = 0;

    try {
      const currentMem = memory || '';
      const seen = new Set();
      for (const kw of keywords) {
        const raw = await kv.lrange(`keyword:${kw}`, 0, -1);
        if (raw) {
          raw.map(e => {
            try { const item = typeof e === 'string' ? JSON.parse(e) : e; if (item && item.memory) { const key = item.memory; if (key !== currentMem && !seen.has(key)) { seen.add(key); entries.push(item); } } }
            catch {}
          });
        }
      }
      totalCount = await kv.get('stats:total') || 0;
    } catch {
      // KV 不可用
    }

    const count = entries.length;

    if (count === 0) {
      // 独特性证书
      let certificate;
      try {
        const prompt = `你是一位温暖的人文作家。以下是一位毕业生的回忆：

用户自画像："${sentence}"
回忆正文："${memory}"

ta是第一个写下这种感受的人——这份回忆会成为后来者的坐标。请为ta写一段温暖的话（不超过80字），不是"你与众不同"的证书，而是一个普通的肯定：你在万物中的坐标，本就不需要被归类。直接输出文字，不要标题和前缀。`;

        certificate = await callDeepSeek([
          { role: 'system', content: '你是一位温暖细腻的人文作家。请直接输出证书文字，不要任何前缀。' },
          { role: 'user', content: prompt }
        ], 0.8);

        certificate = certificate.replace(/^["「『]|["」』]$/g, '').trim();
      } catch {
        certificate = generateCertificate(text);
      }

      return res.json({
        type: 'unique',
        content: certificate,
        matchCount: 0,
        totalCount
      });
    }

    if (count <= 10) {
      // 1v1 共鸣发现
      const other = entries[Math.floor(Math.random() * entries.length)];
      let discovery;
      try {
        const prompt = `你是一位共鸣诗人。下面是两位毕业生的毕业回忆，请发现他们之间"遥远的相似性"。

回忆A：「${sentence}」→ ${memory}
回忆B：「${other.sentence}」→ ${other.memory}

请写一段不超过80字的诗意"发现卡"。要求：
- 不要使用分类语言（不要写"你们都是""你们的共同点是""你们属于"等），不要标签化
- 只描述两个具体感受之间的回响：他们可能在不同的时空、用不同的字句，但触到了同一种东西
- 温暖、具体、诗意，不煽情
直接输出发现文字，不要标题。`;

        discovery = await callDeepSeek([
          { role: 'system', content: '你是一位细腻的共鸣诗人。直接输出发现文字，不要任何前缀或格式标记。' },
          { role: 'user', content: prompt }
        ], 0.8);

        discovery = discovery.replace(/^[\[【（(][^\]】）)]*[\]】）)]\s*/g, '').trim();
      } catch {
        discovery = generateOneOnOneFallback(other);
      }

      const matchList = entries.slice(0, 5).map(e => ({
        signature: formatSignature(e),
        keywords: Array.isArray(e.keywords) ? e.keywords : ['青春']
      }));
      return res.json({
        type: 'resonance',
        content: discovery,
        matchCount: count,
        totalCount,
        currentKeywords: keywords,
        people: matchList
      });
    }

    // >10 人：群像心声
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    const samples = shuffled.slice(0, 3);
    let groupSummary;

    try {
      const prompt = `你是一位人文观察者。以下是几位毕业生的回忆片段，请总结他们的群像心声。

${samples.map((s, i) => `同学${i + 1}：「${s.sentence}」→ ${s.memory}`).join('\n')}

请写一段不超过100字的群像总结，捕捉这些年轻人共同的青春气息。温暖、有共鸣、不说教。直接输出总结文字，不要标题。`;

      groupSummary = await callDeepSeek([
        { role: 'system', content: '你是一位细腻的人文观察者。直接输出总结文字，不要任何前缀。' },
        { role: 'user', content: prompt }
      ], 0.8);

      groupSummary = groupSummary.replace(/^[\[【（(][^\]】）)]*[\]】）)]\s*/g, '').trim();
    } catch {
      groupSummary = generateGroupFallback(samples);
    }

    return res.json({
      type: 'group',
      content: groupSummary,
      matchCount: count,
      totalCount,
      matchedKeyword: keyword,
      matchedSignatures: samples.map(s => formatSignature(s))
    });

  } catch (err) {
    console.error('match error:', err);
    res.status(500).json({ error: '共鸣匹配失败，请稍后再试' });
  }
}
