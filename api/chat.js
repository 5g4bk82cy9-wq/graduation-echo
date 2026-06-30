const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';

async function callDeepSeek(messages, temperature = 0.8) {
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
      max_tokens: 800,
      response_format: { type: 'json_object' }
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`DeepSeek API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const { sentence, identity } = req.body;
  if (!sentence || !sentence.trim()) {
    return res.status(400).json({ error: '请输入你的一句话回忆' });
  }

  try {
    const identityText = identity ? `\nta形容自己是「${identity}」。` : '';
        const systemPrompt = `用户发来一段关于大学四年的自画像。你的任务是理解ta这句话背后的情绪核心，然后：

1. 先找一句真实存在的金句作为开场，可以是原著段落、电影台词、歌词等，必须真实存在，用「」引号括起来并标注出处。
2. 然后用第二人称写一段回应（100-180字），稳稳接住ta的感受。语气可以是朋友共情、长者宽慰、行人见证等不同角度，自然不生硬，像是一个真实的人在说话。

再加一句善意的吐槽，温暖不煽情。
为系统生成若干个索引关键词（内部使用，不展示给用户），用于匹配有相似感受的人。每15字生成1个，最多5个。每个不超过5个字。

请严格以 JSON 格式输出，不要输出任何其他内容：
{
  "quote": "「金句原文」——出处",
  "memory": "（第二人称回应，100-180字）",
  "roast": "（一句善意的吐槽）",
  "keywords": ["关键词1", "关键词2"]
}`;

    const userPrompt = `ta说：${sentence}${identityText}`;

    const raw = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      // 如果 JSON 解析失败，尝试从文本中提取
      const memory = raw.replace(/["{}]/g, '').trim();
      result = { memory, quote: '', roast: '', keyword: '青春' };
    }

    res.json({
      memory: result.memory || '',
      quote: result.quote || '',
      roast: result.roast || '',
      keywords: (() => {
        let kw = Array.isArray(result.keywords) ? result.keywords : ['青春'];
        const maxKw = Math.min(Math.max(Math.ceil((sentence || '').length / 15), 1), 5);
        kw = kw.slice(0, maxKw).map(k => (k || '').trim().slice(0, 5)).filter(Boolean);
        return kw.length > 0 ? kw : ['青春'];
      })()
    });
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: '回忆生成失败，请稍后再试' });
  }
}
