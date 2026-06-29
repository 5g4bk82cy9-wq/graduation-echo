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
    const identityText = identity ? `\n隐藏身份：${identity}` : '';
    const systemPrompt = `你是一位大学记忆作家，擅长用细腻温暖的文字捕捉校园生活的闪光瞬间。

根据用户输入的一句话自画像，为ta写一段200-300字的第二人称回忆。

要求：
1. 基于自画像合理扩充，不虚构具体细节
2. 结尾附带一句善意的吐槽，让回忆温暖但不煽情
3. 引用一句真实存在的古今中外金句（诗词/歌词/台词均可），标注出处
4. 输出一个5字以内的"共鸣关键词"，概括这段回忆的核心情绪

请严格以 JSON 格式输出：
{
  "memory": "（200-300字的第二人称回忆正文）",
  "quote": "「金句原文」——出处",
  "roast": "（一句善意的吐槽）",
  "keyword": "（5字以内的共鸣关键词）"
}`;

    const userPrompt = `用户的自画像：${sentence}${identityText}`;

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
      keyword: (result.keyword || '青春').trim().slice(0, 5)
    });
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: '回忆生成失败，请稍后再试' });
  }
}
